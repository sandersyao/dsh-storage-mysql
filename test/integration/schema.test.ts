import { afterEach, describe, expect, it } from "vitest";

import { ensureSchema, SCHEMA_VERSION } from "../../src/schema.js";
import { closePool, createTestPool, dropDisposer, uniquePrefix } from "../helpers/db.js";

/** 已完成清理任务。 */
const used: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(used.splice(0).map((fn) => fn()));
});

describe("ensureSchema（真实库）", () => {
  it("幂等建表：重复调用不报错", async () => {
    const prefix = uniquePrefix("sch");
    const pool = createTestPool();
    used.push(dropDisposer(prefix));
    try {
      await ensureSchema(pool, prefix, { autoMigrate: true });
      await ensureSchema(pool, prefix, { autoMigrate: true });
      await expect(ensureSchema(pool, prefix, { autoMigrate: true })).resolves.toBeUndefined();
    } finally {
      await closePool(pool);
    }
  });

  it("已应用版本高于期望：抛降级错误", async () => {
    const prefix = uniquePrefix("sch");
    const pool = createTestPool();
    used.push(dropDisposer(prefix));
    try {
      await ensureSchema(pool, prefix, { autoMigrate: true }); // applied = SCHEMA_VERSION
      const names = (await import("../../src/schema.js")).tableNames(prefix);
      await pool.query(`INSERT INTO \`${names.meta}\` (version) VALUES (?)`, [
        SCHEMA_VERSION + 100,
      ]);
      await expect(
        ensureSchema(pool, prefix, { expectedVersion: SCHEMA_VERSION, autoMigrate: true }),
      ).rejects.toThrow(/降级/);
    } finally {
      await closePool(pool);
    }
  });

  it("版本落后且禁止自动迁移：抛错", async () => {
    const prefix = uniquePrefix("sch");
    const pool = createTestPool();
    used.push(dropDisposer(prefix));
    try {
      await ensureSchema(pool, prefix, { autoMigrate: true });
      const names = (await import("../../src/schema.js")).tableNames(prefix);
      await pool.query(`DELETE FROM \`${names.meta}\``); // 回退到未应用
      await expect(
        ensureSchema(pool, prefix, { expectedVersion: SCHEMA_VERSION, autoMigrate: false }),
      ).rejects.toThrow(/禁止自动迁移|版本落后/);
    } finally {
      await closePool(pool);
    }
  });
});
