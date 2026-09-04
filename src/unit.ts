import { type KvUnit, type KvUnitDescriptor, StorageError } from "@deepseek-ai/dsh-storage";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { TableNames } from "./schema.js";

/** 读取快照行的内部形状（records 表）。 */
interface RecordRow extends RowDataPacket {
  readonly table_name: string;
  readonly record_key: string;
  readonly value_json: string;
}

/** 读取全局行的内部形状（units 表）。revision 供 setGlobal CAS 使用。 */
interface UnitRow extends RowDataPacket {
  readonly unit_name: string;
  readonly version: number;
  /** 全局单例乐观锁计数器（loadAll 只读 subset，不访问该字段）。 */
  readonly revision: number;
  readonly global_json: string | null;
}

/**
 * 把一个 JS 值序列化为可入库的 JSON 文本。undefined / 循环 / 非有限数等
 * 会让 JSON.stringify 抛错或返回 undefined，这里统一 fail-closed。
 * @param label - 诊断用位置描述（unit/table/key 或 global）。
 * @param value - 待序列化的不透明值。
 * @returns JSON 文本。
 */
function toJsonText(label: string, value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new Error(`${label}: 值不可 JSON 序列化（undefined/循环/非有限数）`);
  }
  return text;
}

/**
 * 一个已打开的 MySQL 存储单元。数据以 MySQL 行为权威（无进程内缓存镜像），
 * 每个写原语是一句原子 SQL：putRecord/deleteRecord 作用于 records 表，
 * setGlobal 作用于 units 表的 global_json 列。写序由调用方（域层单写链）
 * 负责；本单元只保证单次调用在 medium 上原子且解析后 durable。
 * @module @sandersyao/dsh-storage-mysql/src/unit
 */
export class MysqlKvUnit implements KvUnit {
  private readonly descriptor: KvUnitDescriptor;
  private readonly pool: Pool;
  private readonly names: TableNames;
  private readonly onClose: () => void;
  private readonly tables: ReadonlySet<string>;
  private closed = false;
  /** 在途写（用于 close 排空，语义对齐 json 后端）。 */
  private readonly inFlight = new Set<Promise<unknown>>();

  /**
   * @param descriptor - 打开该单元时所用的描述符。
   * @param pool - 共享写连接池。
   * @param names - 表名集合。
   * @param onClose - 后端在 close 完成后释放 open-slot 的回调。
   */
  constructor(descriptor: KvUnitDescriptor, pool: Pool, names: TableNames, onClose: () => void) {
    this.descriptor = descriptor;
    this.pool = pool;
    this.names = names;
    this.onClose = onClose;
    this.tables = new Set(descriptor.tables);
  }

  /**
   * 读取完整快照：单事务内读 global 与全部记录，保证一致视图。
   * @returns 每张声明表（含空表）的 {key: value} 与 global（未写为 null）。
   */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen();
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [unitRows] = await conn.query<UnitRow[]>(
        `SELECT unit_name, version, global_json FROM \`${this.names.units}\` WHERE unit_name = ?`,
        [this.descriptor.name],
      );
      const [recordRows] = await conn.query<RecordRow[]>(
        `SELECT table_name, record_key, value_json FROM \`${this.names.records}\` WHERE unit_name = ?`,
        [this.descriptor.name],
      );
      await conn.commit();

      // 每张声明表都产出（空）map；再填充 DB 中实际存在的行。
      const tables: Record<string, Record<string, unknown>> = {};
      for (const table of this.descriptor.tables) tables[table] = {};
      for (const row of recordRows) {
        let bucket = tables[row.table_name];
        if (bucket === undefined) {
          bucket = {};
          tables[row.table_name] = bucket;
        }
        bucket[row.record_key] = JSON.parse(row.value_json);
      }
      const globalRow = unitRows[0];
      const global =
        globalRow === undefined || globalRow.global_json === null
          ? null
          : JSON.parse(globalRow.global_json);
      return { tables, global };
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        // 回滚失败忽略：原错误优先。
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * 覆盖写入一条记录（upsert）。
   * @param table - 声明的表名。
   * @param key - 记录键。
   * @param value - 不透明 JSON 值。
   * @returns 写入 durable 后解析。
   */
  putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    const text = toJsonText(`unit '${this.descriptor.name}' table '${table}' key '${key}'`, value);
    const sql = `INSERT INTO \`${this.names.records}\`
      (unit_name, table_name, record_key, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`;
    return this.track(
      this.pool
        .query<ResultSetHeader>(sql, [this.descriptor.name, table, key, text, Date.now()])
        .then(() => undefined),
    );
  }

  /**
   * 删除一条记录（幂等：缺失为 no-op）。
   * @param table - 声明的表名。
   * @param key - 记录键。
   * @returns 删除 durable 后解析。
   */
  deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen();
    this.assertTable(table);
    const sql = `DELETE FROM \`${this.names.records}\`
      WHERE unit_name = ? AND table_name = ? AND record_key = ?`;
    return this.track(
      this.pool
        .query<ResultSetHeader>(sql, [this.descriptor.name, table, key])
        .then(() => undefined),
    );
  }

  /**
   * 写入全局单例，使用基于 revision 的乐观锁 CAS，保证跨节点并发安全。
   *
   * 机制：读当前 `revision` → 条件
   * `UPDATE units SET global_json=?, revision=revision+1 WHERE unit_name=? AND
   * revision=?`；仅当读到的 revision 仍是最新时才写成功并自增，否则（被其他
   * 节点抢先写）`affectedRows=0`，重读重试（上限 MAX_CAS_RETRIES）。
   *
   * 与格式 version 的关系：CAS 自增的是独立的 `revision` 乐观锁列，`version`
   * 仅存 descriptor 格式版本且永不因写值而变，故单元写过多轮全局后仍能以原
   * descriptor 重开（崩溃恢复契约不变）。
   *
   * 注意：本方法接收调用方算好的**完整值**，不负责"读-改-写合并"——并发下两个
   * 调用方各自基于旧快照算出的完整值仍可能互相覆盖。CAS 的责任是把"静默覆盖
   * 丢失"转化为"可控冲突"（affectedRows=0 → 冲突方重读重试或失败），使域层
   * （如 workspace 的 operationTail 串行链 + pendingMutation 恢复机制）有机会
   * 检测并重算。跨节点并发安全因此由"后端 CAS + 域层既有恢复"共同保证，而非
   * 后端单独兜底。
   *
   * 关于重试耗尽抛错类型：上游 @deepseek-ai/dsh-storage 的 StorageErrorCode 联合
   * 不含 'cas-exhausted'（合法值为 backend-not-found | form-not-mounted |
   * duplicate-backend | duplicate-mount | version-mismatch | malformed-medium |
   * closed），也不应为此改发布依赖的 .d.ts。CAS 重试耗尽是"可预期的并发冲突"
   * 而非存储层配置/介质错误，故用普通 Error（消息含 cas-exhausted 标记）抛出，
   * 由域层决定重试或失败。
   *
   * @param value - 不透明 JSON 值。
   * @returns 写入 durable 后解析。
   */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen();
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`);
    }
    const text = toJsonText(`unit '${this.descriptor.name}' global`, value);
    const MAX_CAS_RETRIES = 16;
    // 整段 CAS 作为一个在途写登记，保证 close() 能排空（与 putRecord/deleteRecord
    // 经 track() 的语义一致），避免 close 排空时漏掉本次写。
    const write = async (): Promise<void> => {
      for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
        const [rows] = await this.pool.query<UnitRow[]>(
          `SELECT revision FROM \`${this.names.units}\` WHERE unit_name = ?`,
          [this.descriptor.name],
        );
        const current = rows[0]?.revision ?? 0;
        const [result] = await this.pool.query<ResultSetHeader>(
          `UPDATE \`${this.names.units}\`
           SET global_json = ?, revision = revision + 1
           WHERE unit_name = ? AND revision = ?`,
          [text, this.descriptor.name, current],
        );
        if (result.affectedRows === 1) return;
      }
      throw new Error(
        `unit '${this.descriptor.name}' setGlobal cas-exhausted：乐观锁重试耗尽（持续并发写冲突，可重试）`,
      );
    };
    return this.track(write());
  }

  /**
   * 关闭本单元：拒绝新写、排空在途写、释放 open-slot。幂等。
   * @returns 排空完成后的解析。
   */
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled([...this.inFlight]);
      return;
    }
    this.closed = true;
    await Promise.allSettled([...this.inFlight]);
    this.onClose();
  }

  /** 已关闭则抛 StorageError('closed')。 */
  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError("closed", `unit '${this.descriptor.name}' is closed`);
    }
  }

  /** 未声明的表名是调用方 bug，抛普通 Error（对齐 json 后端）。 */
  private assertTable(table: string): void {
    if (!this.tables.has(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`);
    }
  }

  /**
   * 把一次写纳入在途集合供 close 排空，并原样返回该 Promise。
   * @param promise - 待跟踪的写。
   * @returns 原 Promise。
   */
  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise);
    promise.catch(() => {}).finally(() => this.inFlight.delete(promise));
    return promise;
  }
}
