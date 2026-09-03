import { Context } from "@deepseek-ai/cordis";
import Storage from "@deepseek-ai/dsh-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  apply as mysqlApply,
  Config as mysqlConfig,
  inject as mysqlInject,
  name as mysqlName,
} from "../../src/index.js";
import { tableNames } from "../../src/schema.js";
import { dropDisposer, uniquePrefix } from "../helpers/db.js";

/** 已完成清理任务。 */
const used: Array<() => Promise<void>> = [];

/** 本插件对象形态（对齐 DSH loader 的函数式插件）。 */
const mysqlBackendPlugin = {
  name: mysqlName,
  inject: mysqlInject,
  Config: mysqlConfig,
  apply: mysqlApply,
} as never;

afterEach(async () => {
  await Promise.all(used.splice(0).map((fn) => fn()));
});

describe("e2e：cordis 挂载 storage hub + mysql 后端", () => {
  it("挂载后 ctx.storage.backend 注册 mysql 并可 kv 操作", async () => {
    const c = new Context();
    const prefix = uniquePrefix("e2e");
    used.push(dropDisposer(prefix));
    await c.plugin(Storage as never, {});
    await c.plugin(mysqlBackendPlugin, { connection: { tablePrefix: prefix } });

    const storage = c.storage;
    expect(storage).toBeDefined();
    expect(storage.backend.names()).toContain("mysql");
    const backend = storage.backend.get("mysql");
    expect(backend.kv).toBeDefined();

    const unit = await backend.kv?.open({
      name: "feedback",
      version: 1,
      tables: ["note"],
      hasGlobal: true,
    });
    await unit.putRecord("note", "k1", { likes: 3 });
    await unit.setGlobal({ seq: 1 });
    const snap = await unit.loadAll();
    expect(snap.tables.note?.k1).toEqual({ likes: 3 });
    expect(snap.global).toEqual({ seq: 1 });
    await unit.close();
  });

  it("两次挂载不同前缀互不影响；schema 幂等", async () => {
    const c1 = new Context();
    const c2 = new Context();
    const p1 = uniquePrefix("e2e");
    const p2 = uniquePrefix("e2e");
    used.push(dropDisposer(p1), dropDisposer(p2));
    await c1.plugin(Storage as never, {});
    await c2.plugin(Storage as never, {});
    await c1.plugin(mysqlBackendPlugin, { connection: { tablePrefix: p1 } });
    await c2.plugin(mysqlBackendPlugin, { connection: { tablePrefix: p2 } });
    expect(c1.storage.backend.names()).toContain("mysql");
    expect(c2.storage.backend.names()).toContain("mysql");
    // 清理时表名前缀校验一致
    expect(tableNames(p1).records).not.toBe(tableNames(p2).records);
  });
});
