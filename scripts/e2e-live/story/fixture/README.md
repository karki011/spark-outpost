# Workbench

A tiny project-spend tracker: SQLite (`node:sqlite`) storage, a request handler, HTML
rendering, an analytics list and a CSV export. No dependencies; Node 24 runs the TypeScript
directly.

- `migrations/NNN_name.sql` run in name order. `migrate(db)` in `src/db.ts` applies the ones
  not yet listed in the `schema_migrations(name)` table, so existing databases upgrade in place.
- `src/projects.ts` holds the queries, `src/api.ts` the request handler
  (`handle(db, { method, path, body })` returns `{ status, body }`), `src/ui.ts` the HTML
  (project list and project page), `src/analytics.ts` the analytics list and
  `src/export.ts` the CSV export.
- Tests: `node --test "test/**/*.test.ts"`.
