import type { KvUnitDescriptor } from "@deepseek-ai/dsh-storage";
import { afterEach, describe, expect, it } from "vitest";

import { MysqlStorageBackend } from "../../src/backend.js";
import { ensureSchema, tableNames } from "../../src/schema.js";
import { closePool, createTestPool, dropDisposer, uniquePrefix } from "../helpers/db.js";

/** 已完成清理的前缀表，用于 afterEach 兜底。 */
const used: Array<() => Promise<void>> = [];

/**
 * 构造一份 KV 单元描述符。
 * @param overrides - 描述符覆盖。
 * @returns 描述符。
 */
function desc(overrides: Partial<KvUnitDescriptor> = {}): KvUnitDescriptor {
  return {
    name: "notes",
    version: 1,
    tables: ["note", "meta"],
    hasGlobal: true,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(used.splice(0).map((fn) => fn()));
});

describe("backend kv 契约一致性（与 dsh-storage-json 等价）", () => {
  it("打开空单元：建行，loadAll 返回空表 + global null", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      const snap = await unit.loadAll();
      expect(snap.global).toBeNull();
      expect(snap.tables).toEqual({ note: {}, meta: {} });
    } finally {
      await closePool(pool);
    }
  });

  it("putRecord 后 loadAll 可见；覆盖写入取最新", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      const record = { title: "t", tags: ["a", "b"], nested: { x: 1 } };
      await unit.putRecord("note", "k1", record);
      await unit.putRecord("note", "k1", { title: "t2" });
      const snap = await unit.loadAll();
      expect(snap.tables.note?.k1).toEqual({ title: "t2" });
    } finally {
      await closePool(pool);
    }
  });

  it("特殊字符与非 ASCII 记录值 JSON 往返等值", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      const value = { s: "中文 & <> \"'", arr: [1, "two", null, { a: 1 }] };
      await unit.putRecord("note", "multi-中文_key.with.dot", value);
      const snap = await unit.loadAll();
      expect(snap.tables.note?.["multi-中文_key.with.dot"]).toEqual(value);
    } finally {
      await closePool(pool);
    }
  });

  it("deleteRecord 幂等；删除后不再可见", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      await unit.putRecord("note", "k1", { a: 1 });
      await unit.deleteRecord("note", "missing"); // 幂等 no-op
      await unit.deleteRecord("note", "k1");
      await unit.deleteRecord("note", "k1"); // 再删仍 no-op
      const snap = await unit.loadAll();
      expect(snap.tables.note).toEqual({});
    } finally {
      await closePool(pool);
    }
  });

  it("setGlobal 需声明 global；未写为 null，写入后往返", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      expect((await unit.loadAll()).global).toBeNull();
      await unit.setGlobal({ seq: 3 });
      expect((await unit.loadAll()).global).toEqual({ seq: 3 });
      await unit.close();
      const noGlobal = await backend.kv.open(desc({ hasGlobal: false }));
      await expect(async () => noGlobal.setGlobal({ a: 1 })).rejects.toThrow(/global slot/);
      await noGlobal.close();
    } finally {
      await closePool(pool);
    }
  });

  it("关闭单元后可重开同一后端；写入经跨实例重开仍可见（崩溃恢复）", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const names = tableNames(prefix);
    const backendA = new MysqlStorageBackend(pool, names);
    used.push(dropDisposer(prefix));
    try {
      const unitA = await backendA.kv.open(desc());
      await unitA.putRecord("note", "k1", { durable: true });
      await unitA.setGlobal("G");
      await unitA.close();

      // 跨“进程/实例”重开（新后端 + 新池）。
      const poolB = createTestPool();
      const backendB = new MysqlStorageBackend(poolB, names);
      const unitB = await backendB.kv.open(desc());
      const snap = await unitB.loadAll();
      expect(snap.tables.note?.k1).toEqual({ durable: true });
      expect(snap.global).toBe("G");
      await backendB.close(); // 结束 poolB
    } finally {
      await closePool(pool);
    }
  });

  it("版本不一致：打开已存在单元抛 version-mismatch", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc({ version: 1 }));
      await unit.close();
      await expect(backend.kv.open(desc({ version: 2 }))).rejects.toMatchObject({
        code: "version-mismatch",
      });
    } finally {
      await closePool(pool);
    }
  });

  it("同名单元二次 open（未关闭）抛普通 Error（caller bug）", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      await expect(backend.kv.open(desc())).rejects.toThrow(/already open/);
      await unit.close();
    } finally {
      await closePool(pool);
    }
  });

  it("非法单元名 / 表名抛 malformed-medium", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      await expect(backend.kv.open(desc({ name: "UPPER" }))).rejects.toMatchObject({
        code: "malformed-medium",
      });
      await expect(backend.kv.open(desc({ tables: ["Bad-Name"] }))).rejects.toMatchObject({
        code: "malformed-medium",
      });
    } finally {
      await closePool(pool);
    }
  });

  it("未声明表 putRecord 抛普通 Error", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      await expect(async () => unit.putRecord("nope", "k", { a: 1 })).rejects.toThrow(
        /does not declare table/,
      );
    } finally {
      await closePool(pool);
    }
  });

  it("closed 后调用抛 StorageError('closed')；backend.close 后 open 抛 closed", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      await unit.close();
      await expect(async () => unit.putRecord("note", "k", 1)).rejects.toMatchObject({
        code: "closed",
      });
      await backend.close(); // 同时结束连接池
      await expect(backend.kv.open(desc())).rejects.toMatchObject({ code: "closed" });
    } finally {
      // backend.close 已 end 池；此处吞掉重复 end 的报错。
      await closePool(pool).catch(() => {});
    }
  });

  it("不可 JSON 序列化值（undefined）putRecord 拒绝", async () => {
    const prefix = uniquePrefix("c");
    const pool = createTestPool();
    await ensureSchema(pool, prefix, { autoMigrate: true });
    const backend = new MysqlStorageBackend(pool, tableNames(prefix));
    used.push(dropDisposer(prefix));
    try {
      const unit = await backend.kv.open(desc());
      await expect(async () => unit.putRecord("note", "k", undefined)).rejects.toThrow(/JSON/);
    } finally {
      await closePool(pool);
    }
  });

  it("两个后端用不同前缀相互隔离", async () => {
    const pool = createTestPool();
    const p1 = uniquePrefix("c");
    const p2 = uniquePrefix("c");
    await ensureSchema(pool, p1, { autoMigrate: true });
    await ensureSchema(pool, p2, { autoMigrate: true });
    used.push(dropDisposer(p1));
    used.push(dropDisposer(p2));
    try {
      const b1 = new MysqlStorageBackend(pool, tableNames(p1));
      const b2 = new MysqlStorageBackend(pool, tableNames(p2));
      const u1 = await b1.kv.open(desc());
      const u2 = await b2.kv.open(desc());
      await u1.putRecord("note", "k", "p1");
      await u2.putRecord("note", "k", "p2");
      expect((await u1.loadAll()).tables.note?.k).toBe("p1");
      expect((await u2.loadAll()).tables.note?.k).toBe("p2");
    } finally {
      await closePool(pool);
    }
  });
});
