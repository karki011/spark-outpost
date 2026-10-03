# Developing Spark Outpost

How to run, test and package Spark Outpost from source. Contributors and coding agents: read [AGENTS.md](../AGENTS.md) first. For a full index of the docs, see [docs/README.md](README.md).

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

Open http://127.0.0.1:5173. The first run shows onboarding: Meet Spark, Theme, AI provider (Claude, Codex, or Z.ai with a local CLI or an API key), Tools, Done. Keys are verified with the provider's model list (no tokens used) and stored only in the macOS Keychain under "Spark Outpost". The default runtime talks to the agent over ACP; set `AGENT_RUNTIME=fake` to use the fake provider instead, where including `#fail` in a message shows the error path.

## Commands

| Command                                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | API, worker, and web app with reload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm desktop:dev`                                   | Builds the web app, then runs the Electron desktop shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm desktop:package`                               | Builds and packages the desktop app; see [architecture/RELEASES.md](architecture/RELEASES.md)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm check`                                         | Formatting, lint, typecheck, source rules (comments, 500-line limit), unused code (knip), unit tests                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:db`                                       | Database tests, each in an isolated schema; needs `pnpm db:up`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm test:live`                                     | Vitest tests that call a real provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm test:browser`                                  | Playwright browser tests; starts the dev servers if they are not running; needs `pnpm db:up` and `pnpm db:migrate`                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm docs:screenshots`                              | Regenerates the user guide screenshots against a seeded demo database                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm a11y:contrast`                                 | Checks colour-contrast tokens against the rules in [design/ACCESSIBILITY.md](design/ACCESSIBILITY.md)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm db:setup` / `db:up` / `db:stop` / `db:migrate` | Local PostgreSQL cluster; see [infra/local/README.md](../infra/local/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm bench:harness`                                 | Live harness-vs-direct benchmark (spends real provider credit; `--repeats`, `--budget`, `--resume`, `--report-only`); writes [benchmarks](benchmarks)                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm bench:context`                                 | Offline comparison of the old one-line "Likely files" hint and the new code context block on the bench tasks, in a scratch schema of the test database: hint tokens and files at 5 per task. Never calls a provider or Jev (`--jev fake` gives the old line fake probabilities so it renders, `--jev none` shows it without Jev). Agent tokens, Jev tokens and pass rate come only from recorded `bench:harness` results passed as `--recorded-line` and `--recorded-block`, and print "unknown" otherwise; `--tasks`, `--out`. |
| `pnpm e2e:live`                                      | Live end-to-end scenario runs against a real provider (`--blocks`, `--resume`); see [benchmarks](benchmarks)                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Layout

```text
apps/server   Express API and workflow worker (one codebase, two entry points)
apps/web      React and Vite interface
apps/desktop  Electron desktop shell
packages/contracts  Runtime-validated API and run-event contracts shared by both
infra/local   Native PostgreSQL cluster scripts
docs          Plan, architecture, design kit, user guide, benchmarks
scripts       Bench, e2e-live, codescan, contrast, routing, verifier, coordinator, and jev tools
tests/browser Playwright tests
```

## Further reading

- Product plan: [product/PLAN.md](product/PLAN.md)
- Design kit: [design](design)
- Architecture notes: [architecture](architecture)
- Cutting a beta: [BETA.md](BETA.md)
