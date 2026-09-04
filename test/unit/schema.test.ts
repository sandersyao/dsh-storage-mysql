import { describe, expect, it } from "vitest";

import {
  assertTablePrefix,
  metaDdl,
  recordsDdl,
  SCHEMA_VERSION,
  tableNames,
  unitsDdl,
} from "../../src/schema.js";

describe("schema.assertTablePrefix / tableNames", () => {
  it("合法前缀通过并派生表名", () => {
    expect(assertTablePrefix("dsh_stor_")).toBe("dsh_stor_");
    const n = tableNames("dsh_stor_");
    expect(n.units).toBe("dsh_stor_storage_units");
    expect(n.records).toBe("dsh_stor_storage_records");
    expect(n.meta).toBe("dsh_stor_storage_meta");
  });

  it("非法前缀拒绝（防标识符注入）", () => {
    for (const bad of ["a;b", "a`b", "a b", "a-b"]) {
      expect(() => assertTablePrefix(bad)).toThrow();
    }
  });
});

describe("schema.DDL", () => {
  it("units 表字段带注释", () => {
    const ddl = unitsDdl("u");
    expect(ddl).toContain("COMMENT '");
    expect(ddl).toContain("global_json");
    expect(ddl).toContain("revision");
    expect(ddl).toContain("PRIMARY KEY (unit_name)");
    expect(ddl).toContain("IF NOT EXISTS");
  });

  it("records 表复合主键与注释", () => {
    const ddl = recordsDdl("r");
    expect(ddl).toContain("PRIMARY KEY (unit_name, table_name, record_key)");
    expect(ddl).toContain("COMMENT '");
  });

  it("meta 表版本列", () => {
    const ddl = metaDdl("m");
    expect(ddl).toMatch(/INT NOT NULL/);
    expect(ddl).toContain("PRIMARY KEY (version)");
  });

  it("SCHEMA_VERSION 为 2（新增 revision 乐观锁列）", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});
