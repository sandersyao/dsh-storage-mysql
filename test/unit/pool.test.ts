import { describe, expect, it } from "vitest";

import type { ConnectionSettings } from "../../src/config.js";
import { buildPoolOptions } from "../../src/pool.js";

/**
 * 构造一份连接设置（不含 ssl）。
 */
function conn(): ConnectionSettings {
  return {
    host: "h",
    port: 3306,
    user: "u",
    password: "p",
    database: "d",
    tablePrefix: "x_",
    charset: "utf8mb4",
    connectTimeout: 10000,
    ssl: undefined,
    sslRequired: false,
  };
}

describe("pool.buildPoolOptions", () => {
  it("映射连接与池设置", () => {
    const opts = buildPoolOptions(conn(), { poolSize: 7, queueLimit: 3 });
    expect(opts.host).toBe("h");
    expect(opts.port).toBe(3306);
    expect(opts.user).toBe("u");
    expect(opts.password).toBe("p");
    expect(opts.database).toBe("d");
    expect(opts.connectionLimit).toBe(7);
    expect(opts.waitForConnections).toBe(true);
    expect(opts.queueLimit).toBe(3);
  });

  it("ssl 未配置时不带该键", () => {
    const opts = buildPoolOptions(conn(), { poolSize: 1, queueLimit: 0 });
    expect("ssl" in opts).toBe(false);
  });
});
