import type { Context } from "@deepseek-ai/cordis";
import { storageBackendServiceKey } from "@deepseek-ai/dsh-storage";
import z from "@deepseek-ai/schemastery";

import { MysqlStorageBackend } from "./backend.js";
import { loadSettingsFromEnv, mergeSettings, type SettingsOverrides } from "./config.js";
import { createStoragePool } from "./pool.js";
import { ensureSchema, tableNames } from "./schema.js";

export { MysqlStorageBackend } from "./backend.js";
export type {
  ConnectionSettings,
  PoolSettings,
  SchemaSettings,
  SettingsOverrides,
  StorageSettings,
} from "./config.js";
export type { TableNames } from "./schema.js";

/**
 * 插件 Config schema：schemastery 的 object 属性默认可选（缺省即 undefined），
 * env 为基址、Config 覆盖。凭据只来自 env，绝不进 Config。
 */
export const Config = z.object({
  connection: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    tablePrefix: z.string(),
    charset: z.string(),
    connectTimeout: z.number(),
    sslRequired: z.boolean(),
  }),
  pool: z.object({
    poolSize: z.number(),
    queueLimit: z.number(),
  }),
  schema: z.object({
    autoMigrate: z.boolean(),
  }),
});

/** Cordis 插件名。 */
export const name = "storage-mysql";
/** 存储中心必须先于后端注册。 */
export const inject = ["storage"];

/**
 * 注册 MySQL 存储后端：解析 env 设置 → 建池 → 幂等 schema → 建后端 →
 * 在 `ctx.storage.backend` 注册 `mysql`，并以 `storage.backend.mysql`
 * 提供生命周期服务（供 storage-domain 注入激活）。
 * @param ctx - 插件上下文。
 * @param config - 用户配置覆盖（可空，env 为基址）。
 */
export async function apply(ctx: Context, config?: unknown): Promise<void> {
  const overrides = (config ?? undefined) as SettingsOverrides | undefined;
  const settings = mergeSettings(loadSettingsFromEnv(), overrides);
  const pool = createStoragePool(settings.connection, settings.pool);
  // 连接测试 + 幂等 schema；失败即 fail-closed，阻止启动。
  await ensureSchema(pool, settings.connection.tablePrefix, {
    autoMigrate: settings.schema.autoMigrate,
  });
  const backend = new MysqlStorageBackend(pool, tableNames(settings.connection.tablePrefix));

  ctx.effect(() => {
    const unregister = ctx.storage.backend.register("mysql", backend);
    return async () => {
      unregister();
      await backend.close();
    };
  });
  ctx.provide(storageBackendServiceKey("mysql"), backend);
}
