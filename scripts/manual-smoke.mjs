#!/usr/bin/env node
/**
 * 手动冒烟：build 后运行。自建唯一前缀表，写入/读取/删除，最后清理。
 * 需要 STORAGE_*（或 MYSQL_*）env 指向可用库。
 */
import { createPool } from "mysql2/promise";

import { loadSettingsFromEnv } from "../lib/config.js";
import { ensureSchema, tableNames } from "../lib/schema.js";
import { MysqlStorageBackend } from "../lib/index.js";

const stamp = Date.now().toString(36);
const prefix = `smoke_${stamp}_`;

async function main() {
  const settings = loadSettingsFromEnv();
  const c = settings.connection;
const pool = createPool({
  host: c.host,
  port: c.port,
  user: c.user,
  password: c.password,
  database: c.database,
  charset: c.charset,
  connectTimeout: c.connectTimeout,
  connectionLimit: settings.pool.poolSize,
  waitForConnections: true,
  queueLimit: settings.pool.queueLimit,
});
  const names = tableNames(prefix);
  try {
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, names);
    const unit = await backend.kv.open({
      name: "smokeunit",
      version: 1,
      tables: ["note"],
      hasGlobal: true,
    });
    await unit.putRecord("note", "k1", { ok: true, n: 1 });
    await unit.setGlobal({ seq: 1 });
    const snap = await unit.loadAll();
    if (snap.tables.note?.["k1"]?.ok !== true || snap.global?.seq !== 1) {
      throw new Error("round-trip 校验失败");
    }
    await unit.deleteRecord("note", "k1");
    const after = await unit.loadAll();
    if (Object.keys(after.tables.note ?? {}).length !== 0) throw new Error("删除失败");
    console.log("smoke ok: unit 写入/读取/删除通过，后端/表前缀", prefix);
    await unit.close();
  } finally {
    await pool.query(`DROP TABLE IF EXISTS \`${names.records}\`, \`${names.units}\`, \`${names.meta}\``).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("smoke failed:", error);
    process.exit(1);
  },
);