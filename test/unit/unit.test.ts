/**
 * MysqlKvUnit.setGlobal 乐观锁 CAS 的单测（无库）：用可控的假连接池驱动
 * SELECT/UPDATE，确定性覆盖「无冲突成功 / 被抢先重试成功 / 持续冲突耗尽」。
 * @module test/unit/unit
 */

import type { Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { MysqlKvUnit } from "../../src/unit.js";

/** 假池返回行的最小形状（unit_name/revision/global_json + affectedRows）。 */
interface FakeRow {
  readonly unit_name?: string;
  readonly version?: number;
  readonly revision?: number;
  readonly global_json?: string | null;
  readonly affectedRows?: number;
}

/** UPDATE 命中模式：无冲突 / 首击被抢二次成功 / 始终被抢（耗尽）。 */
type UpdateMode = "clean" | "retry-then-succeed" | "always-conflict";

/**
 * 内存假连接池：仅识别 setGlobal 的 SELECT/UPDATE，返回受控 affectedRows，
 * 用 revision 自增模拟"另一节点在本方读后写前抢先提交"。
 */
class FakePool {
  mode: UpdateMode;
  /** 模拟库内当前 revision。 */
  revision = 0;
  /** UPDATE 语句被调用次数（用于断言重试次数）。 */
  updateCalls = 0;

  /**
   * @param mode - 本次运行的冲突模式。
   */
  constructor(mode: UpdateMode) {
    this.mode = mode;
  }

  /**
   * 按 SQL 前缀分发 SELECT / UPDATE。
   * @param sql - 待执行 SQL。
   * @returns 伪结果元组 [rows, undefined]。
   */
  async query(sql: string): Promise<[FakeRow[] | FakeRow, undefined]> {
    const s = sql.trimStart();
    if (s.startsWith("SELECT")) {
      // SELECT：返回行数组（供 rows[0].revision 读取）。
      return [
        [{ unit_name: "u", version: 1, revision: this.revision, global_json: null }],
        undefined,
      ];
    }
    if (s.startsWith("UPDATE")) {
      // UPDATE：mysql2 返回 ResultSetHeader 对象（非行数组），故直接返回 {affectedRows}。
      this.updateCalls += 1;
      if (this.mode === "clean") {
        this.revision += 1;
        return [{ affectedRows: 1 }, undefined];
      }
      if (this.mode === "always-conflict") {
        // 每次都被"另一节点"抢先：先自增 revision，本方受影响 0 行。
        this.revision += 1;
        return [{ affectedRows: 0 }, undefined];
      }
      // retry-then-succeed：第一次被抢（0 行），第二次本方成功（1 行）。
      if (this.updateCalls === 1) {
        this.revision += 1;
        return [{ affectedRows: 0 }, undefined];
      }
      this.revision += 1;
      return [{ affectedRows: 1 }, undefined];
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
}

/**
 * 用假池构造一个已打开的 MysqlKvUnit。
 * @param pool - 假连接池。
 * @param hasGlobal - 是否声明 global 槽位。
 * @returns 单元实例。
 */
function makeUnit(pool: FakePool, hasGlobal = true): MysqlKvUnit {
  return new MysqlKvUnit(
    { name: "u", version: 1, tables: [], hasGlobal },
    pool as unknown as Pool,
    { units: "p_storage_units", records: "p_storage_records", meta: "p_storage_meta" },
    () => {},
  );
}

describe("MysqlKvUnit.setGlobal（revision CAS）", () => {
  it("无并发冲突：单次 SELECT+UPDATE 即成功并自增 revision", async () => {
    const pool = new FakePool("clean");
    await expect(makeUnit(pool).setGlobal({ n: 1 })).resolves.toBeUndefined();
    expect(pool.updateCalls).toBe(1);
    expect(pool.revision).toBe(1);
  });

  it("并发被抢先：重读 revision 重试后成功（不抛错、终态 revision 连续）", async () => {
    const pool = new FakePool("retry-then-succeed");
    await expect(makeUnit(pool).setGlobal({ n: 2 })).resolves.toBeUndefined();
    expect(pool.updateCalls).toBe(2); // 第一次冲突，第二次成功
    expect(pool.revision).toBe(2);
  });

  it("持续并发写冲突：重试耗尽抛 cas-exhausted", async () => {
    const pool = new FakePool("always-conflict");
    const unit = makeUnit(pool);
    await expect(unit.setGlobal({ n: 3 })).rejects.toThrow(/cas-exhausted/);
    expect(pool.updateCalls).toBe(16); // MAX_CAS_RETRIES=16 次全因 0 行失败
  });

  it("未声明 global 槽位：抛普通 Error（global slot）", async () => {
    const pool = new FakePool("clean");
    await expect(makeUnit(pool, false).setGlobal({ n: 1 })).rejects.toThrow(/global slot/);
  });
});
