# Changelog

## Compatibility: dsh 0.2.1-rc.2

- 升级 `@deepseek-ai/dsh-storage` 到 `0.2.1-rc.2`。
- 将 Cordis 对齐到 `4.0.5`，满足新版 storage 的 `~4.0.5` peer 要求。
- 将消费者侧 `@deepseek-ai/dsh-invariants` peer 范围声明为 `^0.2.0-rc.2`。
- 当前本地 devDependency 与锁文件仍为 `0.1.5-rc.1`，需完成依赖安装和验证后再确认完整工具链兼容性。
- 保留现有 invariant 伴生插件行为：注入 `invariants` 服务并注册本包，不使用版本专属符号。
- 保留现有 `StorageBackend`、`KvUnit`、服务键注册和 MySQL 持久化实现；本地类型、构建和 E2E 验证待执行。

## 0.1.0 (unreleased)

- 首个发布候选：MySQL 存储后端提供方。
- `MysqlStorageBackend` 以 `mysql` 注册到 `ctx.storage.backend`，暴露 `kv` facet，供 `storage-domain`(backend:mysql) 路由使用。
- 与 `dsh-storage-json` 契约等价：`KvUnit` 语义、错误码、单句柄、版本校验、global null 哨兵、幂等删除。
- 独立 `STORAGE_*` env 优先，缺省回退 `MYSQL_*`（与 session-persistence/credentials 同库共存）。
- 三表基名与 session/credentials 不同，规避表名冲突。
- bundle patch 停用默认 `storage-json` 并把 `storage-domain` 切到 `mysql` 后端。
- 覆盖率门禁 lines≥90。
