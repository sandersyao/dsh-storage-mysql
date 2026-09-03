# DEPLOYMENT.md —— 安装与生产集成

## 1. npm 安装（替换默认 json 后端）

本包是 dsh 组合包（`package.json` 声明 `dsh.bundle`，`cordis.patch.yml` 为
配置层）。`dsh plugin add` 后 patch 自动应用：

1. 保留默认 `storage-json` 后端（可经 `storage-domain.routes` 按域继续使用）；
2. 把 `storage-domain.config.backend` 改为 `mysql`（默认 domain 路由到 MySQL）；
3. 插入本后端 `storage-mysql`（默认前缀 `dsh_storage_`）。

## 2. 环境变量

连接凭据/表前缀只来自环境变量或 `.env`（见 `.env.example`）。独立
`STORAGE_*` 优先，缺省回退共享 `MYSQL_*` —— 可与 session-persistence /
credentials 复用同一连接（同库共存）。

| 独立 | 回退 | 默认 | 说明 |
|---|---|---|---|
| `STORAGE_HOST` | `MYSQL_HOST` | 127.0.0.1 | 主机 |
| `STORAGE_PORT` | `MYSQL_PORT` | 3306 | 端口 |
| `STORAGE_USER` | `MYSQL_USER` | 必需 | 最小权限用户 |
| `STORAGE_PASSWORD` | `MYSQL_PASSWORD` | 必需 | 密码 |
| `STORAGE_DATABASE` | `MYSQL_DATABASE` | 必需 | 目标库 |
| `STORAGE_TABLE_PREFIX` | `MYSQL_TABLE_PREFIX` | 必需 | 前缀（安全字符集） |
| `STORAGE_SCHEMA_AUTO_MIGRATE` | `MYSQL_SCHEMA_AUTO_MIGRATE` | true | 启动幂等迁移 |
| `STORAGE_POOL_SIZE` | `MYSQL_POOL_SIZE` | 10 | 池大小 |

## 3. 与 json 并存（按域分流）

不 `disabled` 默认 json；只给 `storage-domain` 配置 `routes`，把特定 domain
映射到 `mysql`，其余仍走 json：

```yaml
- id: storage-domain
  config:
    backend: json
    routes:
      someDomain: mysql
```

## 4. schema 与迁移

启动时幂等建表并写 `Pstorage_meta`；已应用版本高于期望即 fail-closed（不支持降级）；
`STORAGE_SCHEMA_AUTO_MIGRATE=false` 时版本不匹配只报错不迁移。

## 5. 运维注意

- 用户需对目标库有 DDL + DML 权限（启动建表）。
- 最小权限用户应为专用账号，勿用 root。
- 备份沿用 InnoDB 常规备份；单元写入为单事务，无撕裂。