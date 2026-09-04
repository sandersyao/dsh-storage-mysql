/**
 * 跨实例并发写全局单例的集成测试（真实库）。用两个后端句柄模拟两个进程/节点
 * 同时对同一单元写 global，验证 revision CAS：每次成功恰好自增、无静默丢弃、
 * 终值归属某次提交，且格式 version 未被污染（仍可原 descriptor 重开）。
 * @module test/integration/global-concurrency
 */
import type { KvUnitDescriptor } from "@deepseek-ai/dsh-storage";
import type { RowDataPacket } from "mysql2/promise";
import { afterEach, describe, expect, it } from "vitest";

import { MysqlStorageBackend } from "../../src/backend.js";
import { ensureSchema, tableNames } from "../../src/schema.js";
import { closePool, createTestPool, dropDisposer, uniquePrefix } from "../helpers/db.js";

/** units 行的局部形状（读 revision / global_json）。 */
interface UnitRow extends RowDataPacket {
  readonly revision?: number;
  readonly global_json?: string | null;
}

/** 已完成清理的前缀表。 */
const used: Array<() => Promise<void>> = [];

/**
 * 给标识符包反引号。表名由已校验前缀派生（^[A-Za-z0-9_]+$），拼接安全。
 * @param name - 表名。
 * @returns 反引号包裹的标识符。
 */
function qident(name: string): string {
  return `\`${name}\``;
}

afterEach(async () => {
  await Promise.all(used.splice(0).map((fn) => fn()));
});

describe("跨实例并发写全局单例（revision CAS）", () => {
  it("多句柄并发 setGlobal：每次成功恰好自增、无静默丢弃、重开版本不受污染", async () => {
    const prefix = uniquePrefix("cc");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const names = tableNames(prefix);
    // 两个后端（同一 medium）模拟两个进程/节点，各自保有本单元一个句柄。
    const backendA = new MysqlStorageBackend(pool, names);
    const backendB = new MysqlStorageBackend(pool, names);
    used.push(dropDisposer(prefix));
    const unitName = "notes";
    const descA: KvUnitDescriptor = {
      name: unitName,
      version: 1,
      tables: ["note"],
      hasGlobal: true,
    };
    const descB: KvUnitDescriptor = {
      name: unitName,
      version: 1,
      tables: ["note"],
      hasGlobal: true,
    };
    try {
      // 顺序打开，避免两节点对全新单元并发建行的 INSERT 竞态（与本次改动无关）。
      const unitA = await backendA.kv.open(descA);
      const unitB = await backendB.kv.open(descB);

      const writers = 6;
      const perWriter = 2;
      const expectedTotal = writers * perWriter;
      const units = [unitA, unitB];
      const allowed = new Set<string>();

      const jobs: Array<Promise<void>> = [];
      for (let w = 0; w < writers; w++) {
        const unit = units[w % 2];
        for (let k = 0; k < perWriter; k++) {
          const value = { writer: w, seq: k };
          allowed.add(JSON.stringify(value));
          jobs.push(unit.setGlobal(value));
        }
      }
      // 全部必须成功：并发冲突由 CAS 重试消化，不应耗尽抛错。
      await Promise.all(jobs);

      const [end] = await pool.query<UnitRow[]>(
        `SELECT revision, global_json FROM ${qident(names.units)} WHERE unit_name = ?`,
        [unitName],
      );
      // 计数一致：每次成功的 setGlobal 恰好自增 1（共 expectedTotal 次），无静默丢弃。
      expect(end[0]?.revision ?? 0).toBe(expectedTotal);

      const finalJson = end[0]?.global_json ?? null;
      expect(finalJson).not.toBeNull();
      // 终值必须来自某一次实际提交（成员归属）。
      const final = JSON.parse(finalJson as string) as { writer: number; seq: number };
      expect(allowed.has(JSON.stringify(final))).toBe(true);

      // 格式 version 未被 CAS 污染：仍可原 descriptor 重开并读到终值（崩溃恢复不变）。
      await unitA.close();
      await unitB.close();
      const unitC = await backendA.kv.open(descA);
      expect((await unitC.loadAll()).global).toEqual(final);
    } finally {
      await closePool(pool);
    }
  });
});
