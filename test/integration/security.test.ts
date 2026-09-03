import { afterEach, describe, expect, it } from "vitest";

import { MysqlStorageBackend } from "../../src/backend.js";
import { ensureSchema, tableNames } from "../../src/schema.js";
import { closePool, createTestPool, dropDisposer, uniquePrefix } from "../helpers/db.js";

/** 已完成清理任务。 */
const used: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(used.splice(0).map((fn) => fn()));
});

describe("security：键值绝不作为 SQL 标识符，参数化防注入", () => {
  it("恶意 record_key 与值仅作文本存储，不注入、不删表", async () => {
    const prefix = uniquePrefix("sec");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const names = tableNames(prefix);
    const backend = new MysqlStorageBackend(pool, names);
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open({
        name: "secunit",
        version: 1,
        tables: ["note"],
        hasGlobal: false,
      });
      const evilKey = `k'; DROP TABLE \`${names.records}\`; --`;
      const evilValue = { payload: `x'; DROP TABLE \${names.units}; --` };
      await unit.putRecord("note", evilKey, evilValue);
      await unit.close();

      // 重开后表格仍在、恶意数据按原值往返。
      const unit2 = await backend.kv.open({
        name: "secunit",
        version: 1,
        tables: ["note"],
        hasGlobal: false,
      });
      const snap = await unit2.loadAll();
      expect(Object.keys(snap.tables.note ?? {})).toContain(evilKey);
      expect(snap.tables.note?.[evilKey]).toEqual(evilValue);

      const [rows] = await pool.query<Array<{ TABLE_NAME: string }>>(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)`,
        [names.records, names.units, names.meta],
      );
      expect(rows.length).toBe(3); // 三张表均未因注入被删
    } finally {
      await closePool(pool);
    }
  });

  it("非法表前缀在派生表名前即被拒绝", () => {
    expect(() => tableNames("a;b--")).toThrow();
    expect(() => tableNames("a`b")).toThrow();
  });
});
