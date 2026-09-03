import { createPool, type Pool, type PoolOptions } from "mysql2/promise";

import type { ConnectionSettings, PoolSettings } from "./config.js";

/**
 * 由连接设置与池设置构造 mysql2 连接池选项。
 * @param connection - 连接设置。
 * @param pool - 池设置。
 * @returns 可直接交给 createPool 的选项。
 */
export function buildPoolOptions(connection: ConnectionSettings, pool: PoolSettings): PoolOptions {
  return {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    charset: connection.charset,
    connectTimeout: connection.connectTimeout,
    // ssl 未配置时不带该键，避免 exactOptionalPropertyTypes 冲突。
    ...(connection.ssl !== undefined ? { ssl: connection.ssl } : {}),
    connectionLimit: pool.poolSize,
    waitForConnections: true,
    queueLimit: pool.queueLimit,
  };
}

/**
 * 创建存储后端连接池。
 * @param connection - 连接设置。
 * @param pool - 池设置。
 * @returns 连接池实例。
 */
export function createStoragePool(connection: ConnectionSettings, pool: PoolSettings): Pool {
  return createPool(buildPoolOptions(connection, pool));
}
