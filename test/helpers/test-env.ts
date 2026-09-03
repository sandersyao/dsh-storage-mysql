import { config as loadDotenv } from "dotenv";

/**
 * vitest setupFiles：每个 worker 启动时执行。
 * 覆盖 process.env 的独立 STORAGE_DATABASE 为测试库，使所有自动化测试
 * （含插件经 env 读库）使用测试库，隔离于生产库。
 * 测试库的建库/授权由 globalSetup 负责。
 */
loadDotenv({ quiet: true });

process.env.STORAGE_DATABASE =
  process.env.STORAGE_TEST_DATABASE ?? process.env.MYSQL_TEST_DATABASE ?? "test";
