import { config as loadDotenv } from "dotenv";
import { createPool, type Pool } from "mysql2/promise";

import { type TableNames, tableNames } from "../../src/schema.js";

/**
 * 构建测试用 MySQL 连接池（直接读测试 env），供集成/e2e 测试挂载真实后端。
 * @returns 连接池实例。
 */
export function createTestPool(): Pool {
  loadDotenv({ quiet: true });
  return createPool({
    host: process.env.STORAGE_HOST ?? process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.STORAGE_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.STORAGE_USER ?? process.env.MYSQL_USER ?? "dsh",
    password: process.env.STORAGE_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "dsh_dev_password",
    database:
      process.env.STORAGE_DATABASE ??
      process.env.MYSQL_DATABASE ??
      process.env.STORAGE_TEST_DATABASE ??
      "test",
    charset: "utf8mb4",
  });
}

/**
 * 关闭测试连接池。
 * @param pool - 待关闭的连接池。
 */
export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}

/**
 * 按前缀删除测试表（本插件三张表）。
 * @param pool - 连接池。
 * @param prefix - 测试前缀。
 */
export async function dropPrefixTables(pool: Pool, prefix: string): Promise<void> {
  const names: TableNames = tableNames(prefix);
  await pool.query(
    `DROP TABLE IF EXISTS \`${names.records}\`, \`${names.units}\`, \`${names.meta}\``,
  );
}

/**
 * 生成唯一测试表前缀。
 * @param tag - 前缀标签。
 * @returns 唯一前缀。
 */

/**
 * 生成一个自建池的 drop disposer（供 afterEach 用，避免引用已关闭的池）。
 * @param prefix - 测试前缀。
 * @returns 清理函数（自建新池并 end）。
 */
export function dropDisposer(prefix: string): () => Promise<void> {
  return async () => {
    const pool = createTestPool();
    try {
      await dropPrefixTables(pool, prefix);
    } finally {
      await closePool(pool);
    }
  };
}

export function uniquePrefix(tag = "t"): string {
  return `${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_`;
}
