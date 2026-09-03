import { defineConfig } from "vitest/config";

/**
 * Vitest 配置：node 环境、覆盖率门禁。
 * 覆盖率阈值对齐「与 dsh-storage-json 契约逐特性兼容」的验证要求。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/helpers/test-env.ts"],
    globalSetup: ["test/helpers/test-global.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/invariant.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 80,
      },
    },
  },
});
