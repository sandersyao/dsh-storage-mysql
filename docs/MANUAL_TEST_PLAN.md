# MANUAL_TEST_PLAN.md —— 手动冒烟

前置：`docker compose up -d`（或复用已运行的 MySQL），确保 env 指向可用库。

```bash
pnpm build
pnpm test
pnpm test:coverage   # lines≥90 门禁
pnpm smoke           # 手动冒烟脚本（脚本内自建唯一前缀表并清理）
```

冒烟脚本 `scripts/manual-smoke.mjs`：
1. 解析 env → 建池 → 幂等建表；
2. 打开一个临时单元，写入记录 + 全局；
3. loadAll 校验往返；删除记录；
4. 关闭后端、清理测试表并退出码 0/1。

## 集成回归

- 版本不匹配 / closed / 单句柄 / 非法名：见 `test/integration/backend.test.ts`。
- 注入防护：见 `test/integration/security.test.ts`。
