import {
  type KvFacet,
  type KvUnitDescriptor,
  type StorageBackend,
  StorageError,
  UNIT_NAME_RE,
} from "@deepseek-ai/dsh-storage";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { TableNames } from "./schema.js";
import { MysqlKvUnit } from "./unit.js";

/** 读取单元版本行的内部形状。 */
interface UnitVersionRow extends RowDataPacket {
  readonly unit_name: string;
  readonly version: number;
}

/**
 * MySQL 存储后端：一个后端拥有一份连接池（一个 medium），并暴露 `kv`
 * facet。每个打开的单元对应一个 `MysqlKvUnit`，数据持久化在共享的
 * `records`/`units` 表（按 unit_name 隔离）。注册名 `mysql`。
 * @module @sandersyao/dsh-storage-mysql/src/backend
 */
export class MysqlStorageBackend implements StorageBackend {
  private readonly pool: Pool;
  private readonly names: TableNames;
  /** 已打开的单元（name → unit）。 */
  private readonly open = new Map<string, MysqlKvUnit>();
  /** 正在打开的单元（name → 进行中的 Promise），供 close 排空。 */
  private readonly opening = new Map<string, Promise<MysqlKvUnit>>();
  private closed = false;

  /**
   * @param pool - 共享写连接池（本后端拥有其生命周期，close 时 end）。
   * @param names - 表名集合。
   */
  constructor(pool: Pool, names: TableNames) {
    this.pool = pool;
    this.names = names;
  }

  /**
   * `kv` facet：按描述符打开单元（幂等打开由域层单写链保证每次仅一个句柄）。
   */
  readonly kv: KvFacet = {
    open: async (descriptor: KvUnitDescriptor) => {
      if (this.closed) {
        throw new StorageError("closed", "mysql backend is closed");
      }
      validateDescriptor(descriptor);
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        throw new Error(
          `unit '${descriptor.name}' is already open; a unit has exactly one live handle`,
        );
      }
      const opening = this.openUnit(descriptor);
      this.opening.set(descriptor.name, opening);
      return opening.finally(() => this.opening.delete(descriptor.name));
    },
  };

  /**
   * 打开一个单元：单元行不存在则建行（stamp 版本），存在则校验版本。
   * @param descriptor - 单元描述符。
   * @returns 已打开的单元。
   */
  private async openUnit(descriptor: KvUnitDescriptor): Promise<MysqlKvUnit> {
    const [rows] = await this.pool.query<UnitVersionRow[]>(
      `SELECT unit_name, version FROM \`${this.names.units}\` WHERE unit_name = ?`,
      [descriptor.name],
    );
    const existing = rows[0];
    if (existing !== undefined) {
      if (existing.version !== descriptor.version) {
        throw new StorageError(
          "version-mismatch",
          `unit '${descriptor.name}': stored version ${existing.version} != expected ${descriptor.version}`,
        );
      }
    } else {
      // 首次物化：stamp 期望版本（global 默认 NULL）。
      await this.pool.query(
        `INSERT INTO \`${this.names.units}\` (unit_name, version) VALUES (?, ?)`,
        [descriptor.name, descriptor.version],
      );
    }

    const unit = new MysqlKvUnit(descriptor, this.pool, this.names, () => {
      this.open.delete(descriptor.name);
    });
    if (this.closed) {
      await unit.close();
      throw new StorageError("closed", "mysql backend is closed");
    }
    this.open.set(descriptor.name, unit);
    return unit;
  }

  /**
   * 关闭后端：排空进行中的打开、逐个关闭单元，并释放连接池。幂等。
   * @returns 连接池释放后的解析。
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.opening.values()]);
    for (const unit of [...this.open.values()]) await unit.close();
    await this.pool.end();
  }
}

/**
 * 校验单元名与各表名是否匹配 UNIT_NAME_RE（安全作为 SQL 数据列/文件标识）。
 * @param descriptor - 待校验的描述符。
 * @throws 名字非法时抛 StorageError('malformed-medium')。
 */
function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError("malformed-medium", `invalid unit name '${descriptor.name}'`);
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError(
        "malformed-medium",
        `invalid table name '${table}' in unit '${descriptor.name}'`,
      );
    }
  }
}
