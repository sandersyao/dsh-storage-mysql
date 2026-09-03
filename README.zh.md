# @sandersyao/dsh-storage-mysql

<p align="center">
  <img src="assets/dolphin_bookshelf_cartoon.jpg" alt="A cartoon dolphin in front of a bookshelf, busy at a keyboard" width="480" />
</p>
[English](README.md) | 中文

DeepSeek Harness（dsh）存储中心（`ctx.storage`）的 **MySQL 存储后端** —— 内置
`@deepseek-ai/dsh-storage-json` 后端的**契约等价**替代。以插件加载后，在
`ctx.storage.backend` 注册 `mysql`、暴露 `kv` facet，把 KV 单元持久化到
MySQL（InnoDB ACID：崩溃安全、跨进程可见）。

## 安装与使用

```ts
import { apply, Config, inject, name } from '@sandersyao/dsh-storage-mysql'
// 把 storage-domain facility 路由到本后端：
//   ctx.plugin({ apply, Config, inject, name }, { connection: { tablePrefix: 'dsh_stor_' } })
// storage-domain 配置 { backend: 'mysql' } 后，ctx.storage.domain 即由 MySQL 承载。
```

最简做法是走组合包 patch：`dsh plugin add` 后 `cordis.patch.yml` 自动停用
默认 `storage-json`、把 `storage-domain.backend` 指向 `mysql`、并插入本后端。

## 指引

- **独立 dsh profile 试用，不影响现有 json 存储** —— `docs/DSH_PROFILE_TRIAL.md`。
- **生产 / npm 安装与 `cordis.patch.yml` 集成（替换默认后端）** —— `docs/DEPLOYMENT.md`。

## 配置

连接参数来自环境变量 / `.env`（见 `.env.example`）。**独立 `STORAGE_*` 优先，
缺省回退共享 `MYSQL_*`** —— 与 `dsh-session-persistence-mysql` /
`dsh-credentials-mysql` 同库共存或独立配置。插件 `Config` 可选（仅覆盖非敏感项），
凭据绝不进代码/配置。

| 独立 | 回退 | 默认 | 用途 |
|---|---|---|---|
| `STORAGE_HOST` | `MYSQL_HOST` | 127.0.0.1 | 主机 |
| `STORAGE_PORT` | `MYSQL_PORT` | 3306 | 端口 |
| `STORAGE_USER` | `MYSQL_USER` | 必需 | 最小权限用户 |
| `STORAGE_PASSWORD` | `MYSQL_PASSWORD` | 必需 | 密码 |
| `STORAGE_DATABASE` | `MYSQL_DATABASE` | 必需 | 目标库 |
| `STORAGE_TABLE_PREFIX` | `MYSQL_TABLE_PREFIX` | 必需 | 前缀（`^[A-Za-z0-9_]+$`；基名与他包不同） |
| `STORAGE_SSL_REQUIRED` | `MYSQL_SSL_REQUIRED` | false | TLS（暂缓） |
| `STORAGE_POOL_SIZE` | `MYSQL_POOL_SIZE` | 10 | 池大小 |
| `STORAGE_SCHEMA_AUTO_MIGRATE` | `MYSQL_SCHEMA_AUTO_MIGRATE` | true | 启动幂等迁移 |

> **测试隔离**：自动化测试用独立库（`STORAGE_TEST_DATABASE`，默认 `test`）；
> `MYSQL_ROOT_PASSWORD` 仅供测试引导建库授权。

## 存储布局

前缀派生三张表：
- `Pstorage_units` —— 单元 → 格式 `version` + `global_json`（NULL=never-written）。
- `Pstorage_records` —— `(unit_name, table_name, record_key)` → JSON 值。
- `Pstorage_meta` —— 已应用 schema 版本。

基名与 session-persistence / credentials 不同，同库同前缀也不冲突。
`unit_name/table_name/record_key` 一律参数化绑定（绝不作 SQL 标识符）；仅经校验的
前缀拼进反引号表名。

## 后端契约（与 dsh-storage-json 等价）

- 注册 `mysql` 后端并 `ctx.provide(storageBackendServiceKey('mysql'), backend)`。
- `kv.open` 校验名匹配 `UNIT_NAME_RE`、建/校验单元版本、同名单句柄。
- `KvUnit`：`loadAll`（事务快照；`global` `null` 哨兵）、`putRecord`（upsert）、
  `deleteRecord`（幂等）、`setGlobal`、`close`。
- 错误码：`version-mismatch` / `malformed-medium` / `closed`（`StorageError`）。
- 每次写为单条原子 SQL，解析即 durable；已提交写在崩溃重开/跨进程可见。

## Schema 与迁移

启动幂等建表并读写 `Pstorage_meta`；已应用版本高于期望 fail-closed（不支持降级）；
`STORAGE_SCHEMA_AUTO_MIGRATE=false` 时版本不匹配只报错不迁移。

## 开发

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build
docker compose up -d      # 或复用已运行的 MySQL
pnpm test                 # 35 例
pnpm test:coverage        # 覆盖率门禁（lines ≥ 90）
pnpm smoke                # 手动冒烟（先 build）
```

## License

MIT