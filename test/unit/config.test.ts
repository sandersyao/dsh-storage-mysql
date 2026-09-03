import { describe, expect, it } from "vitest";

import { loadSettingsFromEnv, mergeSettings } from "../../src/config.js";

/**
 * 构造最小合法 env（全部 STORAGE_* 段齐全）。
 */
function baseEnv(): NodeJS.ProcessEnv {
  return {
    STORAGE_HOST: "db.example.com",
    STORAGE_PORT: "3307",
    STORAGE_USER: "u",
    STORAGE_PASSWORD: "p",
    STORAGE_DATABASE: "d",
    STORAGE_TABLE_PREFIX: "pre_",
  };
}

describe("config.loadSettingsFromEnv", () => {
  it("独立 STORAGE_* 完整时被解析", () => {
    const s = loadSettingsFromEnv(baseEnv());
    expect(s.connection.host).toBe("db.example.com");
    expect(s.connection.port).toBe(3307);
    expect(s.connection.user).toBe("u");
    expect(s.connection.password).toBe("p");
    expect(s.connection.database).toBe("d");
    expect(s.connection.tablePrefix).toBe("pre_");
    expect(s.connection.charset).toBe("utf8mb4");
  });

  it("STORAGE_* 优先于共享 MYSQL_*（缺省回退）", () => {
    const env = baseEnv();
    delete env.STORAGE_HOST;
    delete env.STORAGE_PORT;
    delete env.STORAGE_PASSWORD;
    env.MYSQL_HOST = "shared.example.com";
    env.MYSQL_PORT = "3306";
    env.MYSQL_PASSWORD = "sharedpwd";
    const s = loadSettingsFromEnv(env);
    expect(s.connection.host).toBe("shared.example.com");
    expect(s.connection.port).toBe(3306);
    expect(s.connection.password).toBe("sharedpwd");
    // USER/DATABASE/TABLE_PREFIX 缺省仍取 STORAGE_*（baseEnv 提供）。
    expect(s.connection.user).toBe("u");
  });

  it("必需连接参数缺失即抛错（fail-closed）", () => {
    const env = baseEnv();
    delete env.STORAGE_HOST;
    delete env.MYSQL_HOST;
    expect(() => loadSettingsFromEnv(env)).toThrow(/HOST/);
  });

  it("端口缺省 3306，非法端口抛错", () => {
    const env = baseEnv();
    delete env.STORAGE_PORT;
    expect(loadSettingsFromEnv(env).connection.port).toBe(3306);
    const bad = baseEnv();
    bad.STORAGE_PORT = "abc";
    expect(() => loadSettingsFromEnv(bad)).toThrow(/STORAGE_PORT/);
  });

  it("schema autoMigrate 默认开启，显式 false 关闭", () => {
    expect(loadSettingsFromEnv(baseEnv()).schema.autoMigrate).toBe(true);
    const off = baseEnv();
    off.STORAGE_SCHEMA_AUTO_MIGRATE = "false";
    expect(loadSettingsFromEnv(off).schema.autoMigrate).toBe(false);
  });
});

describe("config.mergeSettings", () => {
  it("env 为基址，用户覆盖优先", () => {
    const base = loadSettingsFromEnv(baseEnv());
    const merged = mergeSettings(base, {
      connection: { tablePrefix: "override_", port: 4000 },
      pool: { poolSize: 5 },
    });
    expect(merged.connection.tablePrefix).toBe("override_");
    expect(merged.connection.port).toBe(4000);
    expect(merged.connection.host).toBe("db.example.com");
    expect(merged.pool.poolSize).toBe(5);
    expect(merged.pool.queueLimit).toBe(0);
  });

  it("覆盖缺省时保持 env 基址", () => {
    const base = loadSettingsFromEnv(baseEnv());
    const merged = mergeSettings(base, undefined);
    expect(merged.connection.database).toBe("d");
    expect(merged.schema.autoMigrate).toBe(true);
  });
});
