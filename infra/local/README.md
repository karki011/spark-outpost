# Local PostgreSQL

Development uses a native PostgreSQL 17 cluster that lives in the repository's ignored `.local` folder. It does not touch any system PostgreSQL service and does not need Docker.

| Command           | What it does                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:setup`   | Once per machine. Creates the cluster in `.local/postgres`, generates a random password, creates the `spark_outpost` and `spark_outpost_test` databases, and writes `.local/credentials.env`. |
| `pnpm db:up`      | Starts only this cluster, on `127.0.0.1:54329`.                                                                                                                                               |
| `pnpm db:migrate` | Applies pending migrations from `apps/server/migrations`.                                                                                                                                     |
| `pnpm db:stop`    | Stops only this cluster. Data is preserved.                                                                                                                                                   |

Requirements: `brew install postgresql@17`. Set `SPARK_PG_PORT` before `pnpm db:setup` to use a different port.

`pnpm db:up` starts the cluster with `max_connections` 300, so `pnpm test:browser:shards` (6 shards) fits, with room for 8 (each shard's stack may hold 24 connections). A cluster that is already running keeps its old limit until `pnpm db:stop` and `pnpm db:up`. Set `SPARK_PG_MAX_CONNECTIONS` to change it.

The cluster listens on loopback only, uses SCRAM password authentication, and has no Unix socket. `.local/credentials.env` holds `DATABASE_URL` and `TEST_DATABASE_URL`; the server and test scripts load it automatically. Never commit it.

To start over, stop the cluster and delete `.local/postgres` and `.local/credentials.env`. This deletes all local data.

## Migrations at startup

The API and the workflow worker apply pending migrations when they start, so a pull that adds a migration needs no manual step. One process takes a PostgreSQL advisory lock and migrates; the other waits for the lock and then finds nothing left to do. `pnpm db:migrate` uses the same path.

When `BACKUP_DIR` is set, and before applying anything to a database that already has migrations, the server backs it up with `pg_dump --format=custom` into `<BACKUP_DIR>/<database>-<timestamp>.dump` and keeps the newest five per database; `*_test` databases are never backed up. `pg_dump` is found the same way as the cluster binaries: `brew --prefix postgresql@17`, then `PATH`. A failed backup applies nothing. A failed migration stops startup with an error naming the migration and the backup file; earlier migrations in the same start stay applied. Restore a backup with `pg_restore --clean --if-exists --dbname=<url> <file>` while the API and worker are stopped. The desktop app sets `BACKUP_DIR` to its own data folder; local dev with `pnpm dev` does not set it, so no backups are made there.

## Troubleshooting on macOS

- `postmaster became multithreaded during startup`: PostgreSQL needs a valid `LC_ALL`. The scripts set `en_US.UTF-8`; override with `SPARK_PG_LOCALE`.
- A dev server that starts but never answers: on some Macs the native `fsevents` watcher deadlocks. Vite is configured with `useFsEvents: false`, and the server uses `node --watch` instead of `tsx watch` for the same reason.
