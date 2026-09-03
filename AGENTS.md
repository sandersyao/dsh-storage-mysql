# AGENTS.md

本文件为开发本仓库的 Agent（或人工协作者）提供**必须遵守的约定**。读取后按此执行。

## 项目是什么

`@sandersyao/dsh-storage-mysql` —— DeepSeek Harness（dsh）存储中心（`ctx.storage`）的 **MySQL 存储后端**。它把 dsh 的 KV 存储能力持久化到 MySQL，是内部 `@deepseek-ai/dsh-storage-json` 后端的 MySQL 等价实现：以 Cordis 插件形式加载，在 `ctx.storage.backend` 以 `mysql` 注册并暴露 `kv` facet，供域层 `dsh-storage-domain` 路由使用。

## 关键架构事实（先读文档，勿扫源码）

- 参考契约：`@deepseek-ai/dsh-storage` 的 README / 类型（`StorageBackend` / `KvFacet` / `KvUnit` / `KvUnitDescriptor` / `StorageError` / `UNIT_NAME_RE` / `storageBackendServiceKey`）。
- 参考实现模式：`@deepseek-ai/dsh-storage-json` —— 函数式插件（导出 `name/inject/Config/apply`），`ctx.effect` 注册 backend，`ctx.provide(storageBackendServiceKey(name), backend)`；`KvUnit` 语义与错误码与之一致。
- 域层激活依赖注入：`dsh-storage-domain` 的 `apply` 会 `ctx.inject([storageBackendServiceKey(config.backend)])`，**本插件必须 `ctx.provide` 对应服务键**，否则 domain facility 永不挂载。
- 取值/配置分层：连接凭据只来自环境变量 / `.env`；独立 `STORAGE_*` 优先，缺省回退共享 `MYSQL_*`（与 session-persistence / credentials 同库共存）。插件 `Config` 仅覆盖非敏感项。
- 并发模型：进程内写序由域层单写链负责；后端每个写调用是单条原子 SQL（autocommit），解析即提交，崩溃后重开可见（InnoDB ACID）。

## 常用命令

```bash
pnpm install            # 安装依赖（本地 store 在 .pnpm-store）
pnpm typecheck          # 类型检查（strict）
pnpm lint / pnpm fmt    # Biome 格式+lint
pnpm build              # tsup 构建 → lib/
pnpm test               # vitest run
pnpm test:coverage      # 带覆盖率门禁（lines≥90）
pnpm smoke              # 手动冒烟（先 build）
docker compose up -d    # 启动本地 MySQL（env 取自 .env）
```

## 代码风格约束（强制，违反即被打回）

1. **类型声明**（`interface` / `type` / `class`）上方必须有**多行 JSDoc** `/** ... */`。
2. **具名函数与方法**上方必须有**多行 JSDoc**。
3. 所有**注释描述使用中文**（标识符、代码、日志保持英文）。
4. **数据表与字段必须有注释**（DDL 内每列用 `COMMENT '...'` 子句注明用途；表级 `COMMENT=` 只写表的一句话描述，不堆叠列注释）。
5. 复杂/非显然逻辑：在实现上方补中文说明，解释「为什么」。
6. 格式与 lint 由 Biome 统一（`biome check` 必须通过）。

## 安全基线（本项目红线）

- 连接凭据只来自环境变量/.env，**绝不硬编码、绝不打印、绝不进日志**。
- 全部 SQL 用参数化占位符 `?`；`unit_name` / `table_name` / `record_key` **绝不作 SQL 标识符拼接**（仅表前缀可拼接进反引号标识符，且必须经 `^[A-Za-z0-9_]+$` 校验）。
- 表前缀来自配置且校验 `^[A-Za-z0-9_]+$`；基名与 session-persistence / credentials 的表不同，规避同库冲突。
- 记录值视为不透明 JSON：写入前 `JSON.stringify`、读取后 `JSON.parse`；拒绝不可 JSON 序列化值。
- 连接失败 / schema 迁移失败即 fail-closed，阻止启动。

## 测试要求

- 契约一致性套件必须覆盖与 `dsh-storage-json` 等价的后端语义：版本校验、closed、单句柄、幂等删除、global null 哨兵、崩溃重开、错误码。
- 安全用例优先（注入防护、前缀校验、JSON 往返）。
- 覆盖率门禁：`lines ≥ 90`。

## 交接与文档

- 每个任务在 `docs/tasks/T<id>/` 产出 `TASK_STATUS.md`（markdown）+ `TASK.json`（机器可读）。
- 技术债登记到 `docs/TECH_DEBT.md` + `docs/TECH_DEBT.json`。
- 任务队列总表：`docs/TASKS.json`。
