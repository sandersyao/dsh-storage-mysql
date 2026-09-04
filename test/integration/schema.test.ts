import type { RowDataPacket } from "mysql2/promise";
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

  it("v1 → v2 自动迁移：为存量 units 表补 revision 乐观锁列", async () => {
    const prefix = uniquePrefix("sch");
    const pool = createTestPool();
    used.push(dropDisposer(prefix));
    try {
      const names = (await import("../../src/schema.js")).tableNames(prefix);
      // 构造 v1 形态：units 无 revision 列 + meta 记版本 1（等价于旧版建出的库）。
      await pool.query(`CREATE TABLE IF NOT EXISTS \`${names.units}\` (
        unit_name  VARCHAR(255) NOT NULL,
        version    INT NOT NULL,
        global_json LONGTEXT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (unit_name)
      ) ENGINE=InnoDB`);
      await pool.query(`CREATE TABLE IF NOT EXISTS \`${names.meta}\` (
        version    INT NOT NULL,
        applied_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (version)
      ) ENGINE=InnoDB`);
      await pool.query(`INSERT INTO \`${names.meta}\` (version) VALUES (?)`, [1]);
      // 幂等建表 IF NOT EXISTS 不会给既有表加列；真正补列靠版本迁移补 revision。
      await ensureSchema(pool, prefix, { autoMigrate: true });
      const [cols] = await pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'revision'`,
        [names.units],
      );
      expect(cols.length).toBe(1);
    } finally {
      await closePool(pool);
    }
  });
});
