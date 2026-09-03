# @sandersyao/dsh-storage-mysql

<p align="center">
  <img src="assets/dolphin_bookshelf_cartoon.jpg" alt="A cartoon dolphin in front of a bookshelf, busy at a keyboard" width="480" />
</p>

English | [中文](README.zh.md)

The **MySQL storage backend** for the DeepSeek Harness storage hub
(`ctx.storage`) — a drop-in, contract-equivalent alternative to the built-in
`@deepseek-ai/dsh-storage-json` backend. Load it as a plugin; it registers the
`mysql` backend on `ctx.storage.backend`, exposes the `kv` facet, and persists
KV units into MySQL (InnoDB ACID, crash-safe, cross-process visible).

## Install & usage

```ts
import { apply, Config, inject, name } from '@sandersyao/dsh-storage-mysql'
// Route the storage-domain facility to this backend:
//   ctx.plugin({ apply, Config, inject, name }, { connection: { tablePrefix: 'dsh_storage_' } })
// With storage-domain config { backend: 'mysql' }, ctx.storage.domain is MySQL-backed.
```

Easiest path is the bundle patch (see below): add the package and its
`cordis.patch.yml` keeps the default `storage-json` backend and simply points
`storage-domain.backend` at `mysql` — the json backend stays available for
per-domain `routes`.

## Guides

- **Try it in a dsh profile without touching existing json storage** — `docs/DSH_PROFILE_TRIAL.md`.
- **Production / npm install & `cordis.patch.yml` integration (replace the default backend)** — `docs/DEPLOYMENT.md`.

## Configuration

Connection details come from environment variables / a `.env` file (see
`.env.example`). **Independent `STORAGE_*` win; they fall back to the shared
`MYSQL_*`** — reuse the same connection when co-existing with
`dsh-session-persistence-mysql` / `dsh-credentials-mysql`, or configure
independently. The plugin `Config` is optional (only non-secret overrides);
credentials never live in code or config.

| Env | Fallback | Default | Purpose |
|---|---|---|---|
| `STORAGE_HOST` | `MYSQL_HOST` | `127.0.0.1` | Host. |
| `STORAGE_PORT` | `MYSQL_PORT` | `3306` | Port. |
| `STORAGE_USER` | `MYSQL_USER` | — (required) | Least-privilege DB user. |
| `STORAGE_PASSWORD` | `MYSQL_PASSWORD` | — (required) | Password. |
| `STORAGE_DATABASE` | `MYSQL_DATABASE` | — (required) | Target database. |
| `STORAGE_TABLE_PREFIX` | `MYSQL_TABLE_PREFIX` | — (required) | Table prefix, validated `^[A-Za-z0-9_]+$`; base names distinct from session/credentials. |
| `STORAGE_SSL_REQUIRED` | `MYSQL_SSL_REQUIRED` | `false` | TLS (deferred). |
| `STORAGE_POOL_SIZE` | `MYSQL_POOL_SIZE` | `10` | Pool sizing. |
| `STORAGE_SCHEMA_AUTO_MIGRATE` | `MYSQL_SCHEMA_AUTO_MIGRATE` | `true` | Auto-migrate schema on startup. |

> **Test isolation.** Automated tests run against a separate database
> (`STORAGE_TEST_DATABASE`, default `test`); `MYSQL_ROOT_PASSWORD` is used
> only by the test harness to create/grant it.

## Storage layout

Three tables under the prefix:

- `Pstorage_units` — unit → format `version` + `global_json` (NULL = never-written).
- `Pstorage_records` — `(unit_name, table_name, record_key)` → JSON value.
- `Pstorage_meta` — applied schema version.

Base names differ from session-persistence and credentials, so even sharing a
database and prefix causes no collision. `unit_name/table_name/record_key` are
always parameter-bound (never used as SQL identifiers); only the validated prefix
is interpolated into backticked table names.

## Backend contract (equivalent to dsh-storage-json)

- Registers backend `mysql`; `ctx.provide(storageBackendServiceKey('mysql'), backend)`.
- `kv.open` validates names against `UNIT_NAME_RE`, materializes/version-checks a
  unit, and enforces one live handle per unit.
- `KvUnit`: `loadAll` (transactional snapshot; `global` `null` sentinel),
  `putRecord` (upsert), `deleteRecord` (idempotent), `setGlobal`, `close`.
- Errors: `version-mismatch`, `malformed-medium`, `closed` (via
  `StorageError`).
- Each write is a single atomic SQL statement — durable once resolved; committed
  writes survive crash/reopen and are visible cross-process.

## Schema & migration

Startup runs idempotent `CREATE TABLE IF NOT EXISTS`, then reads
`Pstorage_meta`; an applied version higher than expected fails closed
(downgrade unsupported). With `STORAGE_SCHEMA_AUTO_MIGRATE=false`, a mismatch
fails instead of migrating.

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build
docker compose up -d     # or reuse a running MySQL
pnpm test                # 35 tests
pnpm test:coverage       # coverage gate (lines ≥ 90)
pnpm smoke               # manual smoke (build first)
```

## License

MIT