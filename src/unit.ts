import { type KvUnit, type KvUnitDescriptor, StorageError } from "@deepseek-ai/dsh-storage";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { TableNames } from "./schema.js";

/** 读取快照行的内部形状（records 表）。 */
interface RecordRow extends RowDataPacket {
  readonly table_name: string;
  readonly record_key: string;
  readonly value_json: string;
}

/** 读取全局行的内部形状（units 表）。 */
interface UnitRow extends RowDataPacket {
  readonly unit_name: string;
  readonly version: number;
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
   * 写入全局单例。
   * @param value - 不透明 JSON 值。
   * @returns 写入 durable 后解析。
   */
  setGlobal(value: unknown): Promise<void> {
    this.assertOpen();
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`);
    }
    const text = toJsonText(`unit '${this.descriptor.name}' global`, value);
    // unit 行由 open 保证存在，这里仍用 upsert 兜底以保证单元名+版本完整。
    const sql = `INSERT INTO \`${this.names.units}\`
      (unit_name, version, global_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE global_json = VALUES(global_json)`;
    return this.track(
      this.pool
        .query<ResultSetHeader>(sql, [this.descriptor.name, this.descriptor.version, text])
        .then(() => undefined),
    );
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
