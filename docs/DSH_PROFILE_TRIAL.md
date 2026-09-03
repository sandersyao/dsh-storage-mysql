# DSH Profile 试用 MySQL 存储后端（开发期流程）

> 开发期把本插件装进**独立 dsh profile** 试用，不影响现有 profile 的 json 数据。
> 正常使用请走 npm 安装（见 `docs/DEPLOYMENT.md`）。

## 前置

- 本仓库已构建：`cd <repo> && pnpm build`（产出 `lib/`）。
- MySQL 已起、有独立试用库，`dsh` 用户有权限。

## 步骤

1. 建试用 profile：`cp -R ~/.dsh/profiles/web ~/.dsh/profiles/web-storage`
2. 安装本地插件：`dsh plugin --profile web-storage add "file:<仓库绝对路径>"`
3. 确认组合层：其 `cordis.patch.yml` 自动停用 `storage-json`、把
   `storage-domain.backend` 切到 `mysql`。如需不同前缀/按域分流，可在
   profile 的 `cordis.patch.yml` 覆盖该行。
4. 注入环境变量（写 `~/.dsh/.env` 或 shell export）：
   `STORAGE_HOST/PORT/USER/PASSWORD/DATABASE/TABLE_PREFIX`；缺省回退 `MYSQL_*`。
5. 启动：`dsh --profile web-storage`

## 验证与切回

- 域写入（message-feedback 存储、workspace、session-projection-cache 等）落到 MySQL
  试用库的表；重启后数据仍在。
- 随时 `dsh --profile web` 切回现有 json 存储。

## 注意

- 若报 `Cannot find package 'dotenv'`：`cd ~/.dsh/profiles/web-storage && pnpm install --force`。
- 旧 json 数据不自动迁移到 MySQL（如需迁移见 `docs/DEPLOYMENT.md` §4 备注）。
