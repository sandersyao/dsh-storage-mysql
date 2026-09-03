import type { Pool, RowDataPacket } from "mysql2/promise";

/** 当前关系结构 schema 版本号。递增代表一次结构变更（需新增迁移）。 */
export const SCHEMA_VERSION = 1;

/**
 * 表前缀合法字符集：仅允许字母、数字、下划线，防止标识符注入。
 */
export const TABLE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * 表名集合：由前缀派生的三张表名。基名刻意不同于 session-persistence 的
 * sessions/events/_meta 与 credentials 的 credential_refs 等，从而即使多
 * 插件同库同前缀也不冲突。
 */
export interface TableNames {
  /** 存储单元表（单元名 → 版本与全局单例）。 */
  readonly units: string;
  /** 存储记录表（unit+table+key → JSON 值）。 */
  readonly records: string;
  /** schema 版本表。 */
  readonly meta: string;
}

/**
 * 校验表前缀是否只含安全字符。
 * @param prefix - 待校验的表前缀。
 * @returns 原值（校验通过）。
 * @throws 前缀含非法字符时抛出，防止标识符注入。
 */
export function assertTablePrefix(prefix: string): string {
  if (!TABLE_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`表前缀非法：仅允许 [A-Za-z0-9_]，收到 ${JSON.stringify(prefix)}`);
  }
  return prefix;
}

/**
 * 由合法前缀派生三张表名。
 * @param prefix - 已校验的表前缀。
 * @returns 表名集合。
 */
export function tableNames(prefix: string): TableNames {
  assertTablePrefix(prefix);
  return {
    units: `${prefix}storage_units`,
    records: `${prefix}storage_records`,
    meta: `${prefix}storage_meta`,
  };
}

/**
 * units 表 DDL（幂等建表）。每个字段以中文注释说明用途。
 * @param name - units 表名。
 * @returns DDL 语句。
 */
export function unitsDdl(name: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${name}\` (
  unit_name    VARCHAR(255) NOT NULL COMMENT '域/单元名（与 UNIT_NAME_RE 匹配）。仅参数化绑定，绝不作 SQL 标识符拼接',
  version      INT NOT NULL COMMENT '单元格式版本号（descriptor.version）；打开时校验，不匹配抛 version-mismatch',
  global_json  LONGTEXT NULL COMMENT '全局单例的 JSON（未写过=NULL，作为 "never written" 哨兵；域层禁止 null 全局，故 null 不会与合法值混淆）',
  created_at   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '首次建行时间（epoch 毫秒）',
  PRIMARY KEY (unit_name)
) ENGINE=InnoDB COMMENT='存储单元表：域/单元名 → 格式版本与全局单例';
`;
}

/**
 * records 表 DDL（幂等建表）。每个字段以中文注释说明用途。
 * @param name - records 表名。
 * @returns DDL 语句。
 */
export function recordsDdl(name: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${name}\` (
  unit_name    VARCHAR(255) NOT NULL COMMENT '所属单元名（参数化绑定）',
  table_name   VARCHAR(255) NOT NULL COMMENT '单元内声明的表名（与 UNIT_NAME_RE 匹配，参数化绑定）',
  record_key   VARCHAR(255) NOT NULL COMMENT '记录键（任意字符串，参数化绑定；仅作数据，绝不作 SQL 标识符）',
  value_json   LONGTEXT NOT NULL COMMENT '记录的 JSON 值（opaque；写入前 JSON.stringify、读取后 JSON.parse）',
  updated_at   BIGINT NOT NULL COMMENT '写入时间（epoch 毫秒）',
  PRIMARY KEY (unit_name, table_name, record_key)
) ENGINE=InnoDB COMMENT='存储记录表：unit+table+key → JSON 值';
`;
}

/**
 * schema 版本表 DDL（幂等建表）。
 * @param name - meta 表名。
 * @returns DDL 语句。
 */
export function metaDdl(name: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${name}\` (
  version    INT NOT NULL COMMENT 'schema 版本号（主键）',
  applied_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000) COMMENT '迁移应用时间（epoch 毫秒）',
  PRIMARY KEY (version)
) ENGINE=InnoDB COMMENT='schema 版本表：记录已应用的迁移版本';
`;
}

/**
 * schema 迁移选项。
 */
export interface EnsureSchemaOptions {
  /** 期望结构版本；缺省为当前 {@link SCHEMA_VERSION}。 */
  readonly expectedVersion?: number;
  /** 是否允许自动迁移（false 时版本不匹配即失败）。 */
  readonly autoMigrate: boolean;
}

/**
 * 确保 schema 就绪：幂等建表 + 版本校验/迁移。
 * @param pool - 用于执行 DDL 的写连接池。
 * @param prefix - 表前缀。
 * @param options - 迁移选项。
 * @throws 期望版本低于已应用版本（降级不支持）或禁止自动迁移但版本不匹配时抛出。
 */
export async function ensureSchema(
  pool: Pool,
  prefix: string,
  options: EnsureSchemaOptions,
): Promise<void> {
  const expected = options.expectedVersion ?? SCHEMA_VERSION;
  const names = tableNames(prefix);

  // 幂等建表（IF NOT EXISTS）。
  await pool.query(metaDdl(names.meta));
  await pool.query(unitsDdl(names.units));
  await pool.query(recordsDdl(names.records));

  // 读取已应用的最大版本。
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(version), 0) AS v FROM \`${names.meta}\``,
  );
  const applied = Number(rows[0]?.v ?? 0);

  if (applied > expected) {
    throw new Error(`schema 版本降级：已应用 ${applied}，期望 ${expected}。不支持降级。`);
  }
  if (applied === expected) return;

  // applied < expected：需要迁移。
  if (!options.autoMigrate) {
    throw new Error(`schema 版本落后：已应用 ${applied}，期望 ${expected}，且禁止自动迁移。`);
  }
  await pool.query(`INSERT INTO \`${names.meta}\` (version) VALUES (?)`, [expected]);
}
