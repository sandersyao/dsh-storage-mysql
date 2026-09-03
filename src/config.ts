import { config as loadDotenv } from "dotenv";

/**
 * MySQL 存储后端的连接设置。连接参数（host/port/user/password/database）
 * 默认复用 session-persistence / credentials 的 `MYSQL_*`，可用独立
 * `STORAGE_*` 覆盖。凭据只来自环境变量/.env，绝不硬编码。
 */
export interface ConnectionSettings {
  /** 主机地址。 */
  readonly host: string;
  /** 端口。 */
  readonly port: number;
  /** 用户名（专项最小权限用户，非 root）。 */
  readonly user: string;
  /** 密码（敏感，仅供连接使用，不回显、不进日志）。 */
  readonly password: string;
  /** 目标数据库名。 */
  readonly database: string;
  /** 表前缀（校验过安全字符集；基名不同于 session/credentials 的表，规避冲突）。 */
  readonly tablePrefix: string;
  /** 连接字符集。 */
  readonly charset: string;
  /** 连接超时（毫秒）。 */
  readonly connectTimeout: number;
  /** SSL/TLS 选项（本轮暂缓强制，保留配置位）。 */
  readonly ssl: import("mysql2/promise").PoolOptions["ssl"];
  /** 是否强制 TLS。 */
  readonly sslRequired: boolean;
}

/**
 * 连接池设置（后端读写共用）。
 */
export interface PoolSettings {
  /** 池大小上限。 */
  readonly poolSize: number;
  /** 排队上限。 */
  readonly queueLimit: number;
}

/**
 * 启动期 schema 设置。
 */
export interface SchemaSettings {
  /** 启动时是否自动执行 schema 迁移。 */
  readonly autoMigrate: boolean;
}

/**
 * 合并后的完整 MySQL 存储后端设置。
 */
export interface StorageSettings {
  /** 连接设置。 */
  readonly connection: ConnectionSettings;
  /** 连接池设置。 */
  readonly pool: PoolSettings;
  /** schema 设置。 */
  readonly schema: SchemaSettings;
}

/** 默认连接超时（毫秒）。 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** 默认字符集。 */
const DEFAULT_CHARSET = "utf8mb4";

/**
 * 解析整数环境变量；缺失/非法时回退到默认值。
 * @param value - 原始环境变量值。
 * @param fallback - 默认值。
 * @param label - 用于报错的字段名。
 * @returns 解析后的非负整数。
 */
function intFromEnv(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`环境变量 ${label} 非法：期望非负整数，收到 "${value}"`);
  }
  return n;
}

/**
 * 读取一个配置：独立 `STORAGE_*` 优先，缺省回退到共享 `MYSQL_*`。
 * 这样存储后端既能复用 session/credentials 的连接（同库共存），又能独立配置。
 * @param env - 环境变量快照。
 * @param key - 配置段名（如 `HOST`）。
 * @returns 优先值或回退值，均可能为 undefined。
 */
function fromEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const independent = env[`STORAGE_${key}`];
  if (independent !== undefined && independent !== "") return independent;
  const shared = env[`MYSQL_${key}`];
  if (shared !== undefined && shared !== "") return shared;
  return undefined;
}

/**
 * 加载 `.env`（若存在）并解析为完整设置。连接凭据、表前缀均由此注入，
 * 缺省复用 `MYSQL_*`，可用 `STORAGE_*` 独立覆盖。
 * @param env - 环境变量快照（默认 process.env）。
 * @returns 合并后的存储后端设置；必填连接参数缺失即抛错（fail-closed）。
 */
export function loadSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): StorageSettings {
  // 可选加载项目根目录 .env（不存在则忽略）。
  loadDotenv({ quiet: true });

  const host = fromEnv(env, "HOST");
  const user = fromEnv(env, "USER");
  const password = fromEnv(env, "PASSWORD");
  const database = fromEnv(env, "DATABASE");
  const tablePrefix = fromEnv(env, "TABLE_PREFIX");
  if (host === undefined)
    throw new Error("缺少 STORAGE_HOST / MYSQL_HOST：连接凭据必须来自环境变量");
  if (user === undefined)
    throw new Error("缺少 STORAGE_USER / MYSQL_USER：连接凭据必须来自环境变量");
  if (password === undefined) {
    throw new Error("缺少 STORAGE_PASSWORD / MYSQL_PASSWORD：连接凭据必须来自环境变量");
  }
  if (database === undefined) throw new Error("缺少 STORAGE_DATABASE / MYSQL_DATABASE");
  if (tablePrefix === undefined) throw new Error("缺少 STORAGE_TABLE_PREFIX / MYSQL_TABLE_PREFIX");

  const connection: ConnectionSettings = {
    host,
    port: intFromEnv(fromEnv(env, "PORT"), 3306, "STORAGE_PORT/MYSQL_PORT"),
    user,
    password,
    database,
    tablePrefix,
    charset: env.STORAGE_CHARSET ?? env.MYSQL_CHARSET ?? DEFAULT_CHARSET,
    connectTimeout: intFromEnv(
      env.STORAGE_CONNECT_TIMEOUT ?? env.MYSQL_CONNECT_TIMEOUT,
      DEFAULT_CONNECT_TIMEOUT_MS,
      "STORAGE_CONNECT_TIMEOUT/MYSQL_CONNECT_TIMEOUT",
    ),
    ssl: undefined,
    sslRequired:
      env.STORAGE_SSL_REQUIRED === "true" ||
      env.STORAGE_SSL_REQUIRED === "1" ||
      env.MYSQL_SSL_REQUIRED === "true" ||
      env.MYSQL_SSL_REQUIRED === "1",
  };

  const pool: PoolSettings = {
    poolSize: intFromEnv(fromEnv(env, "POOL_SIZE"), 10, "STORAGE_POOL_SIZE/MYSQL_POOL_SIZE"),
    queueLimit: intFromEnv(
      fromEnv(env, "POOL_QUEUE_LIMIT"),
      0,
      "STORAGE_POOL_QUEUE_LIMIT/MYSQL_POOL_QUEUE_LIMIT",
    ),
  };

  const schema: SchemaSettings = {
    autoMigrate:
      env.STORAGE_SCHEMA_AUTO_MIGRATE !== "false" && env.MYSQL_SCHEMA_AUTO_MIGRATE !== "false",
  };

  return { connection, pool, schema };
}

/**
 * 用户提供的设置覆盖（全部可选；凭据只来自 env，这里仅覆盖非敏感项）。
 */
export interface SettingsOverrides {
  /** 连接覆盖（可覆盖非敏感项；密码等敏感项建议仍走 env）。 */
  readonly connection?: Partial<
    Pick<
      ConnectionSettings,
      "host" | "port" | "database" | "tablePrefix" | "charset" | "connectTimeout" | "sslRequired"
    >
  >;
  /** 池设置覆盖。 */
  readonly pool?: Partial<PoolSettings>;
  /** schema 设置覆盖。 */
  readonly schema?: Partial<SchemaSettings>;
}

/**
 * 将用户覆盖合并到 env 基址设置上（env 为默认，用户覆盖优先级更高）。
 * @param base - env 解析的基址设置。
 * @param overrides - 用户覆盖（可空）。
 * @returns 合并后的设置。
 */
export function mergeSettings(
  base: StorageSettings,
  overrides: SettingsOverrides | undefined,
): StorageSettings {
  const c = overrides?.connection;
  const p = overrides?.pool;
  const sc = overrides?.schema;

  return {
    connection: {
      host: c?.host ?? base.connection.host,
      port: c?.port ?? base.connection.port,
      user: base.connection.user,
      password: base.connection.password,
      database: c?.database ?? base.connection.database,
      tablePrefix: c?.tablePrefix ?? base.connection.tablePrefix,
      charset: c?.charset ?? base.connection.charset,
      connectTimeout: c?.connectTimeout ?? base.connection.connectTimeout,
      ssl: base.connection.ssl,
      sslRequired: c?.sslRequired ?? base.connection.sslRequired,
    },
    pool: {
      poolSize: p?.poolSize ?? base.pool.poolSize,
      queueLimit: p?.queueLimit ?? base.pool.queueLimit,
    },
    schema: {
      autoMigrate: sc?.autoMigrate ?? base.schema.autoMigrate,
    },
  };
}
