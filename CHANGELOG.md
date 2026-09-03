# Changelog

## 0.1.0 (unreleased)

- 首个发布候选：MySQL 存储后端提供方。
- `MysqlStorageBackend` 以 `mysql` 注册到 `ctx.storage.backend`，暴露 `kv` facet，供 `storage-domain`(backend:mysql) 路由使用。
- 与 `dsh-storage-json` 契约等价：`KvUnit` 语义、错误码、单句柄、版本校验、global null 哨兵、幂等删除。
- 独立 `STORAGE_*` env 优先，缺省回退 `MYSQL_*`（与 session-persistence/credentials 同库共存）。
- 三表基名与 session/credentials 不同，规避表名冲突。
- bundle patch 停用默认 `storage-json` 并把 `storage-domain` 切到 `mysql` 后端。
- 覆盖率门禁 lines≥90。
