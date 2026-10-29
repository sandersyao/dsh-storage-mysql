# @sandersyao/dsh-storage-mysql

<p align="center">
  <img src="assets/dolphin_bookshelf_cartoon.jpg" alt="A cartoon dolphin in front of a bookshelf, busy at a keyboard" width="480" />
</p>

[English](README.md) | 中文

DeepSeek Harness（dsh）存储中心（`ctx.storage`）的 **MySQL 存储后端** —— 内置
`@deepseek-ai/dsh-storage-json` 后端的**契约等价**替代。以插件加载后，在
`ctx.storage.backend` 注册 `mysql`、暴露 `kv` facet，把 KV 单元持久化到
MySQL（InnoDB ACID：崩溃安全、跨进程可见）。

## 配套插件（分布式 dsh 部署）

本后端是**分布式 dsh 部署**四件套之一：`dsh-storage-mysql`（本仓库） /
`dsh-credentials-mysql` / `dsh-session-persistence-mysql` 把默认存储、凭据、
会话持久化后端切到共享 MySQL；`dsh-workspace-bootstrap` 则在空库启动时声明式
自举一个默认工作区，让首会话可开始。

| 插件 | GitHub 仓库 | npm 包页面 |
| --- | --- | --- |
| `@sandersyao/dsh-workspace-bootstrap` | https://github.com/sandersyao/dsh-workspace-bootstrap | https://www.npmjs.com/package/@sandersyao/dsh-workspace-bootstrap |
| `@sandersyao/dsh-credentials-mysql` | https://github.com/sandersyao/dsh-credentials-mysql | https://www.npmjs.com/package/@sandersyao/dsh-credentials-mysql |
| `@sandersyao/dsh-session-persistence-mysql` | https://github.com/sandersyao/dsh-session-persistence-mysql | https://www.npmjs.com/package/@sandersyao/dsh-session-persistence-mysql |

## 安装与使用

```ts
import { apply, Config, inject, name } from '@sandersyao/dsh-storage-mysql'
// 把 storage-domain facility 路由到本后端：
//   ctx.plugin({ apply, Config, inject, name }, { connection: { tablePrefix: 'dsh_storage_' } })
// storage-domain 配置 { backend: 'mysql' } 后，ctx.storage.domain 即由 MySQL 承载。
```

最简做法是走组合包 patch：`dsh plugin add` 后 `cordis.patch.yml` 保留默认
`storage-json` 后端、把 `storage-domain.backend` 指向 `mysql`（json 后端仍可经
`routes` 按域使用）、并插入本后端。

## 指引

- **独立 dsh profile 试用，不影响现有 json 存储** —— `docs/DSH_PROFILE_TRIAL.md`。
- **生产 / npm 安装与 `cordis.patch.yml` 集成（替换默认后端）** —— `docs/DEPLOYMENT.md`。

## 兼容版本

本版本目标为 `@deepseek-ai/dsh-storage@0.2.1-rc.2` 与
`@deepseek-ai/cordis@4.0.5`（peer 范围为 `~4.0.5`）。本后端继续使用公开的
`StorageBackend` / `KvFacet` / `KvUnit` 契约：`storageBackendServiceKey('mysql')`、
描述符版本校验、`StorageError`、`UNIT_NAME_RE` 以及默认 `Storage` 插件集成方式
仍是本后端的预期集成入口。发布元数据仍保留 E2E fixture 使用的默认入口，
但本地仍需完成运行时和类型检查验证。本包对消费者声明的
`@deepseek-ai/dsh-invariants` peer 范围为
`^0.2.0-rc.2`。本地 devDependency 与锁文件目前仍使用 `0.1.5-rc.1`，需要
单独升级并验证后，才能声称本地工具链已完全对齐。伴生 invariant 插件只注入
`invariants` 服务并注册本包，不依赖版本专属的 invariant 符号。

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