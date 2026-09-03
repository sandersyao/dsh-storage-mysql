# DESIGN.md —— dsh-storage-mysql 设计说明

## 目标

为 dsh 存储中心（`ctx.storage`）提供 MySQL 存储后端，作为内部
`@deepseek-ai/dsh-storage-json` 后端的**契约等价**替代：把 KV 单元持久化到
MySQL，与 json 后端可互换，但天然支持跨进程共享与崩溃一致（InnoDB ACID）。

## 架构要点

- 插件为**函数式后端**：导出 `name/inject/Config/apply`；以 `mysql` 名注册
  到 `ctx.storage.backend`，暴露 `kv` facet，并 `ctx.provide(
  storageBackendServiceKey("mysql"), backend)` 提供生命周期服务。
- 域层 `dsh-storage-domain` 的 `apply` 会 `ctx.inject` 等待该服务键；本插件
  的 `provide` 是域层 facility 得以挂载的前提。
- 后端不持有进程内缓存镜像：`KvUnit` 的每次写都是单条原子 SQL（autocommit），
  `loadAll` 用单事务读出一致快照。进程内写序由域层单写链负责。
- 配置分层：连接凭据只来自环境变量（独立 `STORAGE_*` 优先，回退共享
  `MYSQL_*`）；插件 `Config` 仅覆盖非敏感项，绝不携带密码。

## 数据布局（前缀 P 派生）

| 表 | 主键 | 用途 |
|---|---|---|
| `Pstorage_units` | `unit_name` | 单元 → 格式版本 + 全局单例(global_json，NULL=never-written) |
| `Pstorage_records` | `(unit_name, table_name, record_key)` | 记录：key → JSON 值 |
| `Pstorage_meta` | `version` | 插件关系结构迁移版本 |

基名（`storage_units/records/meta`）与 session-persistence、credentials 不同，
即使同库同前缀也不冲突。`unit_name/table_name/record_key` 一律参数化绑定，
仅前缀可拼接进反引号标识符且经 `^[A-Za-z0-9_]+$` 校验。

## 契约语义（与 json 后端等价）

- 打开空单元：建行并 stamp 版本；存在单元版本不一致抛 `version-mismatch`。
- 单元/表名必须匹配 `UNIT_NAME_RE`，否则 `malformed-medium`。
- 同名单元二次 open（未关闭）抛普通 Error（caller bug）。
- `closed` 后调用抛 `StorageError("closed")`；`close()` 幂等并排空在途写。
- `deleteRecord` 幂等；`setGlobal` 仅当描述符声明 `hasGlobal`。
- 值视作不透明 JSON：写入 `JSON.stringify`、读取 `JSON.parse`；不可序列化即拒绝。
- 崩溃后重开（含跨实例）可见已提交写。

## 未决 / 技术债

见 `docs/TECH_DEBT.md`。
