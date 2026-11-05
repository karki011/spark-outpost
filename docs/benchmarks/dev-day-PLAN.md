# Developer's day benchmark: plan

A live end-to-end benchmark that plays one developer's working day against three arms: the
harness (the app, through its HTTP API as the web UI drives it), direct Claude and direct
Codex. Fourteen sessions run in order; some continue earlier ones. It answers one question:
over a realistic day, which arm gets the most work right, and what does each right answer cost
once the developer's own time is counted?

Status: this is the live plan used by `pnpm e2e:live --blocks dev-day`. The latest run is the three-arm rerun in [e2e-2026-09-29.md](e2e-2026-09-29.md) (part 3, with per-session scores in [e2e-2026-09-29.json](e2e-2026-09-29.json)). The dry run (`AGENT_RUNTIME=fake`) executes every session on every
arm end to end and renders the report. Code: `scripts/e2e-live/dev-day/`.

## How to run

```sh
# The plan: sessions, expected spend and caps per arm
pnpm e2e:live --blocks dev-day --plan

# Check the fixtures: every hidden test fails before and passes with the reference change
pnpm e2e:live --blocks dev-day --selftest --dir /private/tmp/dev-day-selftest

# Dry run, no spend
AGENT_RUNTIME=fake pnpm e2e:live --blocks dev-day --dir /private/tmp/dev-day-dry --label dry --timeout-min 3

# Live
pnpm e2e:live --blocks dev-day --live --dir /private/tmp/dev-day-live --label live --shots
```

Flags: `--budget` (default and hard cap $25), `--arms harness,direct-claude,direct-codex`,
`--match s0[1-4]` (a subset of sessions), `--timeout-min` (per turn, default 15),
`--hourly-usd` (the developer's time, default $100/h), `--shots` (a screenshot of each harness
chat), `--keep-data` (keep the stack's schema for debugging).

Needs `TEST_DATABASE_URL` naming a `*_test` database (this worktree uses
`spark_outpost_test_devday`). Ports: API 4339, web 5194, Jev stub 4419 (dry run only), GitHub
stub 4429. Never 4318, 5173 or 4399.

## The repos

- **spark**: a throwaway copy of this checkout's HEAD made with `git archive` (no history, so
  the answers under `scripts/e2e-live/dev-day/` and this plan cannot be read), with
  `pnpm install --offline`. Two problems are planted and committed before the day starts: a typo
  on the Spend tab ("reportd") and `percent()` rounding down. Project checks: the analytics unit
  tests.
- **workbench**: a small fixture (`fixtures/workbench`): `node:sqlite` storage with numbered SQL
  migrations, a request handler and HTML rendering, tested with `node --test`. Its `origin` is
  `https://github.e2e.localhost/e2e-bench/workbench.git`, rewritten by `url.insteadOf` to a local
  bare repo; every other `https://` remote is rewritten to a dead path, so nothing can reach a real
  host.
- **external**: a `git clone --local --no-hardlinks` of the read-only orders-web-app clone, whose
  path comes from `DEV_DAY_EXTERNAL_REPO`. The original is fingerprinted (HEAD, status without
  optional locks, refs) before the day and checked after s14.

Each arm gets its own copies. Hidden tests live in `fixtures/hidden/`, are copied in only after a
session ends, run, and are deleted.

**Continuity without cascades.** Chats continue across sessions (threads), but the repo does not
carry an arm's mistakes forward: after scoring, the bench puts the repo back at the session's
starting commit and applies the reference change (`fixtures/reference/`), as the developer would
after fixing things by hand. A failure is charged its repair time instead of breaking every later
session.

## The sessions

Level is the permission level the developer picks (today's mapping in `levels.ts`). "Behaviour"
lists the harness-only expectations, reported beside the outcome and never inside it.

| # | Session | Repo · thread | Level | Right action | Outcome checks | Harness behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| s01 | How does the code scan pick files? | spark · scan | Ask before edits | answer | names `skip.ts`/`skipReason` and what it skips; no edits | no crew |
| s02 | Brainstorm showing skipped files | spark · brainstorm | Ask before edits | options | 2+ options; no plan card, no edits | no crew |
| s03 | Plan CSV export for Analytics (plan only) | spark · csv | Ask before edits | plan | a plan (card or reply); no edits | plan card shown and the approved plan saved (by the harness, from its offer card, or by hand: each click is an intervention) |
| s04 | "Do it" in a fresh session | spark · csv (Start fresh) | Ask before edits | build | hidden tests (`spendCsv`, quoting, the Spend tab button), analytics suite, scope | Builder and Critic prompts carry the agreed plan; Critic ran |
| s05 | One-line typo | spark · typo | Ask before edits | build | hidden test, suite, only `spend-summaries.ts` changed | no Architect, no Critic, no plan card |
| s06 | Small bug: 66% should be 67% | spark · bug | Ask before edits | build | hidden tests, suite, scope | checks ran |
| s07 | Review my uncommitted changes | spark · review | Ask before edits | answer | names both planted problems: `plural()` in the edited old file, `median()` in the new file; no edits | Critic ran |
| s08 | "Make it faster." | spark · vague | Ask before edits | clarify | asked before touching anything; no edits | (the bench stops the run on the clarify card) |
| s09 | Quote a passage of s01's answer and ask about it | spark · scan | Ask before edits | answer | names the skip code; no edits | no crew |
| s10 | Rename `expenses.amount` to `amount_cents` | workbench · migration | Ask before edits | build | hidden: new column, old rows survive an in-place upgrade, API totals, old migrations not rewritten | top tier, worktree, card before the first Builder |
| s11 | Story: tags on projects (DB + API + UI) | workbench · tags | Ask before edits | build | hidden: PUT/GET tags, normalising, 400/404, escaped chips, upgrade of an old DB | Builder-sized chunks with no parallel Builders; context handoff at 75% (reported only if it triggers); Critic ran |
| s12 | Small endpoint, "ship it as a draft PR" | workbench · ship | Full auto | build | hidden tests; harness: a draft PR on the GitHub stub whose branch is on the local bare remote | draft PR |
| s13 | Stop mid-build, then "continue" | workbench · interrupt | Ask before edits | build | hidden tests including "defined once, tested once" | the second turn continued the same session |
| s14 | Question on orders-web-app | external · external | Ask before edits | answer | names the knowledge library path and "classify first"; the original repo unchanged | no crew |

Continuations: s09 continues s01's chat (select-to-chat: the quote block and annotation are
built with the web app's own `composeMessage`), s04 continues s03's chat after "Start fresh",
s13 has two turns in one session.

**Direct arms, same day.** They get the same prompts. Where the harness keeps state the direct
arms cannot, the developer does the work and it counts: in s04 the developer pastes the s03 plan
into a new session (one intervention); in s12 they push the branch and open the draft PR
themselves (one or two interventions). A thread keeps its Claude agent session or Codex thread
(`codex exec resume`).

## Scoring

Per session and arm (`score.ts`):

- **Right kind of action.** The bench classifies what happened: any changed file is a build; else
  a clarify card or a short reply that asks back is clarify; a plan card or a plan-shaped reply is
  a plan; option lists with trade-offs are options; the rest is an answer. An expected answer also
  accepts a list or plan-shaped answer; the others need an exact match.
- **Outcome checks** (all must hold to pass): the kind; no edits where none were asked; answer and
  review patterns; hidden tests and the repo's suite green; changes inside the allowed paths; the
  read-only original untouched; for the harness in s12, the draft PR (skipped, not failed, while
  Ship is not in the build).
- **Harness expectations**: reported in their own table and never decide pass or fail.
- **Interventions**: checkpoint cards answered, plans saved by hand, pasted context, PRs opened
  by hand. Tool approvals are counted separately as clicks.
- **Wall time and cost** per session; per-session caps are 3× the expected cost (at least $0.50).
  The harness is stopped in flight when it passes its cap; direct Claude runs under the bench's
  $1.50 run cap; Codex is bounded by the turn timeout. Before each round (one session on every
  arm) the runner projects 1.3× the expected cost and stops if that would pass the budget.
- **Repair cost**: each session has an estimate of the developer's minutes to notice, undo and
  redo a failure (3 to 60 minutes). Failed sessions are charged it; each intervention costs a
  minute. Minutes are priced at `--hourly-usd`.

The report (`dev-day-<label>.md` and `.json` in the run directory) ranks arms by **pass rate
first**, then by cost per pass including the developer's time. Spend alone never ranks an arm
first, and a cheaper arm that passes less is never recommended. Tables: arm summary, per-session
results (kind expected → got, pass, hidden tests, interventions, clicks, wall, cost, repair
estimate, diff, failed checks), harness expectations, and per-session details with crews,
interventions and screenshot links.

## Expected live cost

From `--plan` (Sonnet-class Builders, medium effort):

| Arm | Expected | With the 1.3× budget projection |
| --- | --- | --- |
| harness | $7.55 | $9.82 |
| direct Claude | $4.60 | $5.98 |
| direct Codex | $3.51 | $4.56 (estimated from tokens) |
| all three | $15.66 | $20.36 (hard cap $25) |

The biggest single items are s11 (harness $1.80) and s04 (harness $1.20).

## Remaining checklist item

The permission rename, the Full auto → draft PR merge, and the `levels.ts`/`balanced.ts`/Ship
checks that used to be listed here are done, and the 2026-09-29 run used the new modes. Only one
item is still open:

- Swap `github-stub.ts` for `apps/server/test/fake-github.ts`, so both fake the same API surface.
  `fake-github.ts` exists but `github-stub.ts` is still what the dev-day bench uses.
