# Spark Outpost

A local-first workspace where people give a goal to AI agents, follow progress, make decisions, and receive results with evidence. See [docs/product/PLAN.md](docs/product/PLAN.md) and the design kit in [docs/design](docs/design).

Contributors and coding agents: read [AGENTS.md](AGENTS.md) first.

## Requirements

- Node.js 24 and pnpm 12 (`corepack enable pnpm`)
- PostgreSQL 17: `brew install postgresql@17`

## First run

```bash
pnpm install
pnpm db:setup
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open http://127.0.0.1:5173. The first run shows onboarding: enter your name and connect Claude or Codex with a local CLI or an API key. Keys are verified with the provider's model list (no tokens used) and stored only in the macOS Keychain under "Spark Outpost". Chat replies still come from the fake provider until the provider adapter lands (F-12); include `#fail` in a message to see the error path.

## Commands

| Command                                              | What it does                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | API, worker, and web app with reload                                                                                                                            |
| `pnpm check`                                         | Formatting, lint, typecheck, source rules (comments, 500-line limit), unused code (knip), unit tests                                                            |
| `pnpm test:db`                                       | Database tests, each in an isolated schema; needs `pnpm db:up`                                                                                                  |
| `pnpm test:browser`                                  | Playwright browser tests; starts the dev servers if they are not running; needs `pnpm db:up` and `pnpm db:migrate`                                              |
| `pnpm db:setup` / `db:up` / `db:stop` / `db:migrate` | Local PostgreSQL cluster; see [infra/local/README.md](infra/local/README.md)                                                                                    |
| `pnpm tasks move <ID> <status> "note"`               | Update [docs/tasks/board.json](docs/tasks/board.json) and regenerate [docs/KANBAN.md](docs/KANBAN.md)                                                           |
| `pnpm bench:harness`                                 | Live harness-vs-direct benchmark (spends real provider credit; `--repeats`, `--budget`, `--resume`, `--report-only`); writes [docs/benchmarks](docs/benchmarks) |

## Layout

```text
apps/server   Express API and workflow worker (one codebase, two entry points)
apps/web      React and Vite interface
packages/contracts  Runtime-validated API and run-event contracts shared by both
infra/local   Native PostgreSQL cluster scripts
docs          Plan, architecture, design kit, task board
scripts       Task board and source-rule tools
tests/browser Playwright tests
```
