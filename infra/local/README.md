# Local PostgreSQL

Development uses a native PostgreSQL 17 cluster that lives in the repository's ignored `.local` folder. It does not touch any system PostgreSQL service and does not need Docker.

| Command           | What it does                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:setup`   | Once per machine. Creates the cluster in `.local/postgres`, generates a random password, creates the `spark_outpost` and `spark_outpost_test` databases, and writes `.local/credentials.env`. |
| `pnpm db:up`      | Starts only this cluster, on `127.0.0.1:54329`.                                                                                                                                               |
| `pnpm db:migrate` | Applies pending migrations from `apps/server/migrations`.                                                                                                                                     |
| `pnpm db:stop`    | Stops only this cluster. Data is preserved.                                                                                                                                                   |

Requirements: `brew install postgresql@17`. Set `SPARK_PG_PORT` before `pnpm db:setup` to use a different port.

The cluster listens on loopback only, uses SCRAM password authentication, and has no Unix socket. `.local/credentials.env` holds `DATABASE_URL` and `TEST_DATABASE_URL`; the server and test scripts load it automatically. Never commit it.

To start over, stop the cluster and delete `.local/postgres` and `.local/credentials.env`. This deletes all local data.

## Troubleshooting on macOS

- `postmaster became multithreaded during startup`: PostgreSQL needs a valid `LC_ALL`. The scripts set `en_US.UTF-8`; override with `SPARK_PG_LOCALE`.
- A dev server that starts but never answers: on some Macs the native `fsevents` watcher deadlocks. Vite is configured with `useFsEvents: false`, and the server uses `node --watch` instead of `tsx watch` for the same reason.
