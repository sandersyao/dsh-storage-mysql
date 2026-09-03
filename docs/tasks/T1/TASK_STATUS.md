# T1 — 首个 MySQL 存储后端发布候选

状态：✅ 完成（代码/测试/构建全绿）

## 范围
- 函数式后端插件：`name=storage-mysql`、`inject=["storage"]`、`Config`、`apply`。
- `MysqlStorageBackend` 以 `mysql` 注册到 `ctx.storage.backend`，暴露 `kv` facet；
  `ctx.provide(storageBackendServiceKey("mysql"), backend)`。
- `MysqlKvUnit` 实现 `KvUnit`：loadAll/putRecord/deleteRecord/setGlobal/close。
- 三表布局 + 前缀校验 + 幂等建表/迁移（`ensureSchema`）。
- 独立 `STORAGE_*` env，回退 `MYSQL_*`；插件 `Config` 覆盖非敏感项。
- 组合包 patch（cordis.patch.yml）：停用 storage-json、storage-domain.backend=mysql、插入本插件。
- 测试：unit/integration/e2e 共 35 例全绿；覆盖率 lines 96%。

## 产出
- 契约语义与 dsh-storage-json 等价（错误码、单句柄、幂等删除、global null 哨兵、崩溃重开）。
- 文档：DESIGN / DEPLOYMENT / DSH_PROFILE_TRIAL / MANUAL_TEST_PLAN。
