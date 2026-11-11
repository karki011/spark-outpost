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

| Command                                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                                       | API, worker, and web app with reload                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm desktop:dev`                                                                               | Builds the web app, then runs the Electron desktop shell                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm desktop:package`                                                                           | Builds and packages the desktop app; see [architecture/RELEASES.md](architecture/RELEASES.md)                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm check`                                                                                     | Formatting, lint, typecheck, source rules (comments, 500-line limit), unused code (knip), unit tests                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test:db`                                                                                   | Database tests, each in an isolated schema; needs `pnpm db:up`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm test:live`                                                                                 | Vitest tests that call a real provider                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm test:browser`                                                                              | Playwright browser tests; starts the dev servers if they are not running; needs `pnpm db:up` and `pnpm db:migrate`                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm test:changed`                                                                              | Unit tests that import a file changed since `main` (committed, staged, modified or new)                                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm test:db:changed`                                                                           | Database tests that import a changed file; runs the whole db project when a migration, the db setup files, a fake the suite starts by path, the user guide, the lockfile or a package or TypeScript config changed. `--dry-run` prints the choice, `--base=<ref>` compares with another branch                                                                                                                                                                                      |
| `pnpm test:browser:changed`                                                                      | Browser specs for the changed folders, from the map in `tests/browser/spec-map.ts`, plus changed specs, specs that import a changed helper and a small shell group; runs every spec when a shared path or a path with no rule changed, and nothing when no spec is affected. Prints the rule behind each choice; takes `--dry-run` and `--base=<ref>`. Never runs perf or screenshot specs                                                                                          |
| `pnpm test:browser:perf`                                                                         | Only the `*-perf.spec.ts` specs, against a production build of the web app                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm test:browser:shards [N] [spec filter...]`                                                  | Builds the web app once, then runs the browser specs (perf specs left out) in N Playwright processes (6 by default), each with its own ports and `spark_outpost_test_slotN` database; needs `TEST_DATABASE_URL` to name `spark_outpost_test` and about 24 free Postgres connections per shard. `--first-slot=N` picks the slots, `--dry-run` prints the plan                                                                                                                        |
| `pnpm docs:screenshots`                                                                          | Regenerates the user guide screenshots against a seeded demo database                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm a11y:contrast`                                                                             | Checks colour-contrast tokens against the rules in [design/ACCESSIBILITY.md](design/ACCESSIBILITY.md)                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm db:setup` / `db:up` / `db:stop` / `db:migrate`                                             | Local PostgreSQL cluster; see [infra/local/README.md](../infra/local/README.md)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm bench:loop`                                                                                | Event-loop bench for the code index and `spark_find`, in a scratch schema of the test database: indexes a repo (`--repo`, default this one), runs finds before, during and after the build, eight at once, and a full rebuild and warm refresh, printing loop lag (p50, p99, max), find latency and peak memory. Exits non-zero when lag p99 passes `--max-lag-p99` (50 ms) or find p95 passes `--max-find-p95` (2500 ms). Run it alone; other load on the machine shows up as lag. |
| `node --import tsx scripts/turn-tasks/runner/cli.ts --provider claude --task 1,2 --label <name>` | Runs scratch tasks through the single-session turn with the fake agent; `--live` uses the real provider (paid turns). `scripts/turn-tasks/report/cli.ts --label <name>` writes the report to `.local/turn-tasks/results/`. Needs `TEST_DATABASE_URL`                                                                                                                                                                                                                                |

## Turn bench

`TEST_DATABASE_URL=<test db> DATABASE_URL=<test db> ./node_modules/.bin/tsx scripts/turn-bench.ts --runs 10 --out .local/turn-bench/before.json` runs real server turns against the fake ACP agent, which has no random delays and never calls a provider, and prints a table. It works in its own schema of the test database and removes it afterwards. Run two builds with `--out` and compare the JSON; `--ladder 1,10,50` sets the chat sizes for the detail read.

- **first text**: from just before the message is sent to the first assistant text event on the run event stream (the `run_events` notification the API turns into the live stream).
- **done**: from the same start to the run being finished.
- **first turn / second turn**: a new chat, then a second message in it. `session reused` counts how many second turns reused the live agent session; fewer than all is a regression.
- **chat detail**: time and body size of `GET /api/conversations/:id` over loopback through the real app, for a chat with N finished turns of four tool steps each, seeded by running fake turns (`#steps 4`). One read is discarded as warm-up.

Numbers are medians and p90s of `--runs` samples (p90 is the maximum below 10 runs). The first turn includes starting the agent process and is the noisiest; all timings carry a few ms of polling resolution and move with machine load, so compare runs made back to back on a quiet machine. It is a script, not a test, and asserts nothing.

## Code Mode and Terminal recording

[Code Mode](architecture/CODE_MODE.md) is on by default for chat runs. Settings → Chats & autonomy persists the user’s choice; `SPARK_CODE_MODE=0` disables it for the installation without replacing that choice. Set the override consistently for API and workflow processes. Terminal sessions do not receive Code Mode.

Migration 0217 adds the default-on Code Mode preference. Migration 0218 changes only the Terminal-recording default for newly created profiles; existing on/off values remain. Full Terminal recording applies to Claude Code with Spark’s mod, not Codex.

Focused checks: `pnpm test:db apps/server/test/code-mode-settings.db.test.ts apps/server/test/terminal-record-settings.db.test.ts` and `pnpm test:browser tests/browser/codemode-setting.spec.ts tests/browser/terminal-record-setting.spec.ts`. Real provider composition uses `pnpm test:live apps/server/test/codemode.live.test.ts`; it needs connected Claude/Codex CLIs and uses real model calls.

## Layout

```text
apps/server   Express API and workflow worker (one codebase, two entry points)
apps/web      React and Vite interface
apps/desktop  Electron desktop shell
packages/contracts  Runtime-validated API and run-event contracts shared by both
infra/local   Native PostgreSQL cluster scripts
docs          Plan, architecture, design kit, user guide, benchmarks
scripts       Checks (source, guide, contrast, ACP coverage), test selection, codescan and benchmark tools, turn-tasks (scratch tasks for the single-session turn)
tests/browser Playwright tests
```

## Further reading

- Product plan: [product/PLAN.md](product/PLAN.md)
- Design kit: [design](design)
- Architecture notes: [architecture](architecture)
- Cutting a beta: [BETA.md](BETA.md)
