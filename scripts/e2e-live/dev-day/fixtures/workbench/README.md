# Workbench

A tiny project-budget tracker: SQLite (`node:sqlite`) storage, a request handler, and HTML
rendering. No dependencies; Node 24 runs the TypeScript directly.

- `migrations/NNN_name.sql` run in name order. `migrate(db)` in `src/db.ts` applies the ones
  not yet listed in the `schema_migrations(name)` table, so existing databases upgrade in place.
- `src/projects.ts` holds the queries, `src/api.ts` the request handler
  (`handle(db, { method, path, body })` returns `{ status, body }`), `src/ui.ts` the HTML.
- Tests: `node --test "test/**/*.test.ts"`.
