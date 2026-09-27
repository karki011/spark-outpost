# Kanban

Generated from `docs/tasks/board.json` by `pnpm tasks`. Do not edit by hand.

## Backlog (5)

- **F-14** Port mockup: rail, Home, Blob Scout moods _(phase 4)_
- **F-15** Port mockup: projects, search, archive, history in the sidebar _(phase 4)_
- **F-17** Evaluate an AG-UI client agent with connect() for reconnects _(phase 1)_
- **F-18** Worker shutdown semantics for long-running provider processes _(phase 1)_
- **F-20** Show the collapsed work log ("Worked for Ns") on finished runs _(phase 4)_

## Ready (3)

- **F-10** App-wide status stream for sidebar, Home, rail badge, favicon _(phase 1)_
- **F-21** Make Ctrl+C on pnpm dev stop every child process _(phase 0)_ — 2026-09-25: pnpm 12's native wrapper did not forward Playwright's SIGTERM to Vite; tests now bypass pnpm, dev still uses it.
- **F-24** Apply pending migrations at startup, after a database backup _(phase 0)_ — 2026-09-27: Pending migrations crashed the dev API twice (502s). Needed for the Electron app, where users can't run pnpm db:migrate.

## In progress (0)

_None_

## Review (6)

- **F-9** Authenticate UI, API, and stream with a per-launch token _(phase 0)_ — 2026-09-27: Every API request, the app and run event streams, uploads and the terminal socket require X-Spark-Token (401 otherwise, SHA-256 + timingSafeEqual); host/origin checks stay first. Launchers pass SPARK_API_TOKEN (removed from the API env); pnpm dev writes .local/api-token (0600) and the Vite proxy injects the header, so the browser never holds it. Agents are denied api-token files. Evidence: unit 158 files/1182 tests, db 53/306 on spark_outpost_test_token, browser --workers=1 170 passed / 5 axe/titles timeouts that passed on rerun (31/31 incl. launch-token spec). Random port and Electron injection remain for the Electron work.
- **F-12** ACP client adapter in the worker, tested against a fake ACP agent over stdio _(phase 1)_ — 2026-09-25: Chat path (no project folder) runs Claude and Codex over ACP: one process per run, private empty folder, chat mode forced, model and effort via config options, permissions declined with a visible step, cancel, readable errors. Checks: pnpm check 81 unit, test:db 37, test:browser 12, test:live 6 (both providers: context recall, blocked write, cancel under 6 s). Checked in the app with real Claude and Codex replies. Known gap: Codex can still write under /tmp.
- **F-13** Approval card and interrupt flow _(phase 1)_ — 2026-09-26: M2 Do with approvals for Claude: 0015_approvals, decide() with four levels and always-ask list, approval gate with NOTIFY and 1 s poll, Stop cancels, 30 min timeout fails the run, recovery expires, payload-hash bound decisions, git and file snapshots with revert. Codex Do unavailable (live probe: commands never ask). Evidence: unit decide/ACP tests, approvals DB tests, approvals browser spec, live Claude test (edit allowed, ls allowed for run, git push denied, reverted). Needs independent review.
- **F-16** Port mockup: model picker and context ring from capability snapshots _(phase 2)_ — 2026-09-25: Composer ported from the mockup: plus menu (attachments marked Soon), model picker with real models from each agent's capability snapshot (Claude: Default, Opus 5.5, Fable 5.1, Sonnet 5, Haiku 4.5; Codex: 6 Astra/Sol/Luna and older), effort segmented control and meter, permissions, per-chat settings, context ring from ACP usage_update. Checked live: picked Sonnet 5 and the reply confirmed it. Chat replies render Markdown (react-markdown, remark-gfm, remend, Shiki themed by tokens). Theme menu ported. check 87, test:db 40, test:browser 14.
- **F-22** Onboarding flow from the mockup with real provider verification _(phase 1)_ — 2026-09-25: Built from the mockup (4 steps; Tools and Sign in left out on purpose). pnpm check 33 unit, test:db 26, test:browser 6 pass. Checked by hand against the real Anthropic API (fake key gives 401) and a real missing claude CLI. Not yet checked: success with a real key or CLI; the user will test with their own key. Not ported yet: eyes following the typing caret, and descriptions on model cards.
- **F-23** Embedded terminal for CLI install and login _(phase 1)_ — 2026-09-25: Smart flow: verification reports cli_missing or not_logged_in and the terminal starts on the matching step (install or claude auth login). Terminal closes and checks again by itself after a clean install or a successful login. Claude login verified for free with claude auth status (the test request is only a fallback). Parent Claude Code env vars stripped. Browser tests are hermetic (fake codex CLI, no host PATH). check 60, test:db 29, test:browser 7 pass.

## Blocked (1)

- **F-19** CI workflow _(phase 0)_

## Done (9)

- **F-1** Monorepo, tooling, and AGENTS.md source-rule checks _(phase 0)_ — 2026-09-25: pnpm check passes: prettier, eslint, tsc, source rules, 17 unit tests. Rule behavior covered by scripts/source-rules.test.ts.
- **F-2** Native local PostgreSQL cluster scripts _(phase 0)_ — 2026-09-25: db:setup/up/stop/migrate verified on this Mac (Postgres 17.11). Needed LC_ALL fix, documented in infra/local/README.md.
- **F-3** Foundation schema and migration runner _(phase 0)_ — 2026-09-25: 0001_foundation.sql applied once; second db:migrate reports up to date. API and worker call assertMigrated at startup.
- **F-4** Event log with lease fencing, job queue, and expired-lease recovery _(phase 0)_ — 2026-09-25: queue.db.test.ts: 5 concurrent claims distinct; fenced append rejected after expiry (verified test fails when the check is removed); expired lease -> outcome_unknown, not reclaimed.
- **F-5** API: conversations, idempotent messages, cancel, SSE replay from cursor _(phase 0)_ — 2026-09-25: api.db.test.ts: ordered replay, Last-Event-ID resume without duplicates, 204 at end, host/origin/content-type guards, 400/404 validation. conversations.db.test.ts: duplicate send returns one run.
- **F-6** Worker with fake provider emitting AG-UI events _(phase 0)_ — 2026-09-25: worker.db.test.ts: success with persisted reply, cancel -> RUN_FINISHED cancelled, #fail -> RUN_ERROR.
- **F-7** Web chat slice: sidebar, thread, work log, composer, themes _(phase 0)_ — 2026-09-25: Checked in the browser pane: streaming steps and text, Stop button, sidebar status and title. Theme test passes.
- **F-8** Browser test: send, stream, reload without duplicates _(phase 0)_ — 2026-09-25: pnpm test:browser cold start: 3 passed, exit 0, no leftover processes.
- **F-11** ACP coverage spike with claude-agent-acp _(phase spike)_ — 2026-09-25: Live spike against claude-agent-acp 0.81.2 and codex-acp 1.13.1: findings table in docs/architecture/ACP_AGENTS.md (config options, modes, permission flow, tool calls, usage, cancel under 60 ms). Found codex-acp read-only mode still writes /tmp without asking.
