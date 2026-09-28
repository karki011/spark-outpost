# Developer's day · 2026-09-28 rerun (harness only)

A second live run of the [developer's-day benchmark](dev-day-PLAN.md) to check the fixes that
followed the [first run](dev-day-2026-09-28.md). Harness arm only, played twice: once at **Ask
before edits** (the same level as run 1) and once at **Auto-edit** (every Ask-before-edits session
moved to Auto-edit; s12 stays Full auto). The direct arms haven't changed, so direct Claude and
direct Codex are run 1's results. Branch `bench/dev-day-rerun` on top of `86ced33` (all the
dev-day fixes merged).

Data: [dev-day-2026-09-28-rerun.json](dev-day-2026-09-28-rerun.json) has both scored runs, the
summary, the fix checklist and the issues. As in run 1, the s14 replies about the read-only work
repo are left out.

**Spend: $5.23 of the $10 cap.** Ask before edits cost $2.33 and Auto-edit cost $2.90. No
rate limits. No session hit its cap. Nothing stopped for budget before a round.

**n = 1 per cell.** Each pass or fail is one run, and one flip moves a pass rate by 7 points.
The fix confirmations below are strong: each one has a run id, a log line or a card. The rankings
are weak.

## Headline

| Rank | Arm | Passed | Spend | Interventions | Tool clicks | User time | Spend + user time | Per pass incl. user time | Wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | direct Claude (run 1) | 14/14 (100%) | $2.20 | 2 | 0 | 2 min | $5.53 | **$0.40** | 10.7 min |
| 2 | **harness, Ask before edits (rerun)** | **14/14 (100%)** | $2.33 | 10 | 31 | 10 min | $19.00 | **$1.36** | 11.1 min |
| 3 | direct Codex (run 1) | 12/14 (86%) | $2.56 | 2 | 0 | 47 min | $80.89 | $6.74 | 16.6 min |
| 4 | harness, Auto-edit (rerun) | 12/14 (86%) | $2.90 | 4 | 42 | 49 min | $84.56 | $7.05 | 21.0 min |
| (was 2) | harness, Ask before edits (run 1) | 13/14 (93%) | $1.83 | 8 | 29 | 28 min | $48.50 | $3.73 | 8.1 min |

Ranked by pass rate first, then by cost per pass including the developer's time: $100/h, 1 min
per intervention, plus each failed session's repair estimate. Tool clicks are tool approvals.
They aren't priced, and the direct arms need none, so clicks aren't like for like.

1. **At Ask before edits the harness now passes every session.** s07 (the review) was the only
   failure in run 1, and it passes now. Pass rate ties direct Claude. Cost per pass incl. user
   time fell from $3.73 to $1.36, because the 20-minute repair for s07 is gone. Direct Claude is
   still cheaper per pass ($0.40), because the harness asks the developer 10 times to Claude's 2.
2. **All nine fixed issues are confirmed** (table below). Two are confirmed only in part: s13
   resumes the session, but the Stop landed before any edit; s08's speed options are shown by
   code and by the Auto-edit run, not by the Ask-before-edits card itself.
3. **Auto-edit is worse than Ask before edits on this day: 12/14.** It fails two sessions that
   Ask before edits passes. It builds on the vague "Make it faster." instead of asking (N1). On
   s04 its own Critic fix loop chases hardening findings until the tool-call budget stops the run
   (N2). It needs fewer interventions (4 vs 10), but it costs more ($2.90 vs $2.33) and takes
   almost twice the wall time (21 vs 11 min).
4. **Ask before edits now asks more, not less** (8 → 10 interventions). The plan card saved one.
   The risky card on s10 and s11 and one "Fix these findings" on s11 added three. The six keep
   cards stay, as designed.

## Per session: harness, run 1 vs rerun

Each cell reads: result · kind the bench saw · hidden tests · interventions/tool clicks · wall ·
cost.

| Session | Run 1, Ask before edits | Rerun, Ask before edits | Rerun, Auto-edit |
|---|---|---|---|
| s01 Question: code scan | pass · plan · – · 0/0 · 43 s · $0.173 | pass · plan · – · 0/0 · 33 s · $0.142 | pass · plan · – · 0/0 · 32 s · $0.170 |
| s02 Brainstorm | pass · options · – · 0/0 · 57 s · $0.116 | pass · options · – · 0/0 · 38 s · $0.128 | pass · options · – · 0/0 · 27 s · $0.102 |
| s03 Plan only | pass · plan · – · **2**/0 · 34 s · $0.137 | pass · plan · – · **1**/0 · 67 s · $0.173 | pass · plan · – · 1/0 · 41 s · $0.139 |
| s04 Build from plan | pass · build · 4/4 · 1/6 · 74 s · $0.295 | pass · build · 4/4 · 1/8 · 161 s · $0.575 | **FAIL** · build · 4/4 · 1/16 · 735 s · $1.295 |
| s05 Typo | pass · build · 1/1 · 1/3 · 20 s · **$0.127** | pass · build · 1/1 · 1/3 · 17 s · **$0.039** | pass · build · 1/1 · 0/2 · 16 s · $0.037 |
| s06 Rounding bug | pass · build · 2/2 · 1/3 · 22 s · $0.073 | pass · build · 2/2 · 1/3 · 22 s · $0.076 | pass · build · 2/2 · 0/2 · 26 s · $0.085 |
| s07 Review | **FAIL** · plan · – · 0/0 · 46 s · $0.105 | **pass** · plan · – · 0/0 · 31 s · $0.123 | pass · plan · – · 0/0 · 63 s · $0.105 |
| s08 "Make it faster" | pass · clarify · – · 0/0 · 1 s · $0.000 | pass · clarify · – · 0/0 · 1 s · $0.000 | **FAIL** · build · – · 0/7 · 91 s · $0.185 |
| s09 Quoted passage | pass · plan · – · 0/0 · 12 s · $0.033 | pass · plan · – · 0/0 · 17 s · $0.041 | pass · answer · – · 0/0 · 9 s · $0.028 |
| s10 Migration rename | pass · build · 4/4 · 1/5 · 62 s · $0.227 | pass · build · 4/4 · 2/4 · 50 s · $0.228 | pass · build · 4/4 · 1/5 · 60 s · $0.186 |
| s11 Tags story | pass · build · 6/6 · 1/7 · 51 s · $0.202 | pass · build · 6/6 · 3/7 · 140 s · $0.387 | pass · build · 6/6 · 1/6 · 90 s · $0.269 |
| s12 Full auto → draft PR | pass · build · 2/2 · 0/0 · 35 s · $0.148 | pass · build · 2/2 · 0/0 · 29 s · $0.172 | pass · build · 2/2 · 0/0 · 35 s · $0.137 |
| s13 Stop, then "continue" | pass · build · 3/3 · 1/5 · 27 s · $0.088 (no Stop fired) | pass · build · 3/3 · 1/6 · 56 s · $0.138 | pass · build · 3/3 · 0/4 · 28 s · $0.086 |
| s14 Read-only work repo | pass · answer · – · 0/0 · 6 s · $0.110 | pass · answer · – · 0/0 · 5 s · $0.110 | pass · answer · – · 0/0 · 6 s · $0.072 |

Run 1's s13 Stop never fired. Its separate s13 rerun (Stop at 8 s) started over: pass · 3/3 ·
1/7 · 41 s · $0.115.

### Interventions: Auto-edit vs Ask before edits

| Session | Ask before edits (rerun) | Auto-edit (rerun) |
| --- | --- | --- |
| s03 | Approve plan | Approve plan |
| s04 | Keep | Stop at "Continue past the budget?" (tool calls 120/120) |
| s05, s06, s13 | Keep (each) | none: "Auto-edit kept the changes" |
| s08 | none (stopped on the clarify card) | none, because it never asked (N1) |
| s10 | Build it, Keep | Build it (kept by Auto-edit) |
| s11 | Build it, Fix these findings, Keep | Build it (kept by Auto-edit) |
| **Total** | **10** (+31 tool clicks) | **4** (+42 tool clicks) |

Auto-edit removes the keep cards as designed. On s04 and s08, though, it spent the
developer's trust instead: it kept an unasked-for refactor, and it ended a correct build as
"Stopped".

## The fixed issues

| # (run 1) | Fix | Status | Evidence |
| --- | --- | --- | --- |
| 1 · s07 | Review requests go to a Critic-only flow with the full diff | **Confirmed** | Run `01a0e785-e85c-76c7-8640-c27f0f3a30a5`: the crew was only `critic gpt-6-sol·high`. It named `plural(0, 'turn')` returning "0 turn" (analytics-model.ts:38), `median()` never sorting, and the even-length case. Auto-edit (`01a0e799-ada2-…`) named both bugs too. |
| 2 · s12 | Builders never push or run `gh`; Ship refuses internal commits | **Confirmed** | At both levels the fake remote holds only the Ship branch (`spark/add-get-projects-id-expenses-the-01a0e789`), with one commit on top of the day's history. There is no `spark/<id>/bolt` branch, no "parallel base" commit and no "can't open a PR" text. The Builder prompt says "Don't commit, push, open a pull request, run `gh`…". Draft PR #1 opened on the stub with no click. |
| 3 · s05/s06 | Code-scan breadth no longer forces top tier | **Confirmed** | Builders ran on Sonnet at both levels (run 1: Opus). The typo cost $0.039 (run 1: $0.127). |
| 4 · s13 | Stop, then "continue", resumes the session | **Confirmed, session level** | Turn 1 stopped at 9.3 s at both levels. Turn 2 logged `Continued session` (`01a0e78a-91e9-…`, `01a0e79f-9298-…`), and hidden tests passed 3/3. The Stop came before the first edit ("No prior edits exist yet"), so keeping partial edits wasn't exercised. |
| 5 · s03 | Plan-only requests get a plan card | **Confirmed** | No answer-or-build card this time. The plan-only card "Approve the plan?" (Approve plan / Revise the plan / Stop) appeared, and the plan was saved as agreed automatically. Interventions went from 2 to 1. s04's Builder prompt carried `## Agreed plan`. |
| 6 · s04/s11 | Critic runs for plan builds, 3+ source files or 2+ parts, never for one-liners | **Confirmed** | The Critic ran on s04, s10 and s11 at both levels, and not on s05, s06, s12 or s13. The fix loop ran live for the first time: at Ask before edits, s11 took one round to fix a GET/PUT tag-order mismatch ("Fixed after 1 review round"). |
| 7 · s10 | "Start this risky change?" before destructive or migration work | **Confirmed** | s10 showed the card before the first Builder at both levels ("This change looks destructive…", Build it / Stop). It also fires on s11's additive migration (N3). |
| 8 · builds | Auto-edit keeps by itself unless checks fail or the Critic has concerns; Ask before edits always shows the keep card | **Confirmed** | At Auto-edit the keep cards were `decided_by: level` with "Auto-edit kept the changes: the checks pass and the Critic, if it ran, found no correctness problems. Revert undoes them." (s05, s06, s08, s10, s11, s13). At Ask before edits all six builds showed the keep card. |
| 9 · s08 | "Make it faster" clarify options are about speed | **Confirmed, indirectly** | `clarify.ts` offers Startup / Page load / Tests / Build / API and database. The Auto-edit run assumed the first of them ("Assumed: Page load: make pages load and render faster"). The bench cancelled the Ask-before-edits card before its payload was saved, so those exact choices weren't captured. |

## New issues and regressions

1. **N1 · high · Auto-edit builds on "Make it faster." without asking (s08).** Run
   `01a0e79a-b636-70c5-acc4-cd52c41b8c4b`. Intake: Jev `vague: 0.94`, `intent: refactor`. The
   gate was `{"level": "hands-off", "askAt": 0, "actAt": 0.6, "decision": "act", "clarifyBelow":
   null}`. The run took the step "Assumed: Page load: make pages load and render faster", and a
   Sonnet Builder code-split `apps/web/src/app/App.tsx` with `React.lazy`. Auto-edit then kept the
   change by itself. The reply ends "Assumed you meant: Page load… Say so if you meant something
   else." Ask before edits asked within 1.0 s. This is the same failure as Codex's s08 in run 1.
   Suggested fix: clarify on a high vague score at Auto-edit too, at least before editing, and
   keep assume-and-act for Full auto.
2. **N2 · high · At Auto-edit the Critic fix loop chases hardening findings until the tool-call
   budget stops a correct build (s04).** Run `01a0e78d-80da-7131-9d5d-43bf02fa3cf0`: Builder, then
   Critic ×4, with 3 fix rounds. The rounds covered blob-URL revoke timing, spreadsheet formula
   injection and `\r` quoting. Then "Continue past the budget?" appeared (`tool_calls` 120/120),
   the Balanced user chose Stop, and the run ended with "Stopped: the tool calls budget ran out."
   It took 735 s and $1.30. Hidden tests passed 4/4 and so did the suite, so the work was right
   and the bench's `finished` check is what failed. The same kinds of findings at Ask before edits
   went to the keep card and were kept ($0.575). The loop (`review-loop.ts`, `fixesFindingsItself`
   for any level except `balanced`) auto-fixes whatever Jev reads as correctness. Here that
   included new hardening outside the plan. Suggested fix: auto-fix only regressions against the
   request or plan; don't let fix rounds spend the whole run's tool budget; and when the budget
   runs out after a fix round with checks passing, keep the last passing state and finish instead
   of failing. Scored strictly this is a fail with a 30-min repair. Counted as a pass (the code
   was right), Auto-edit would be 13/14 with about $2.66 per pass incl. user time. It would still
   rank below Ask before edits.
3. **N3 · medium · The risky card fires for an additive migration (s11).** It showed at both
   levels (`01a0e787-afc4-…`, `01a0e79d-5f01-…`) with the text: "This change touches the database
   schema with a migration, and existing data depends on it." The migration was `CREATE TABLE`
   for tags. That's one more intervention for every story that adds a table. Suggested fix: keep
   the card for destructive schema changes (rename, drop, type change, data rewrite) or a high
   Jev destructive score.
4. **N4 · low · Auto-edit still asks for every read-only shell command.** Auto-edit had 42 tool
   clicks against 31 at Ask before edits. `cat`, `wc`, `find`, `grep` and `npx tsc` were all
   `decided_by: user`. Leaving out s04 and s08, it's 19 vs 23, so Auto-edit hardly reduces
   clicks. Suggested fix: auto-allow read-only commands and the project's own check commands at
   Auto-edit.
5. **N5 · low · The Critic rule costs time and money on sessions that already passed.** At Ask
   before edits, spend was $2.33 vs $1.83 (+27%) and wall time 11.1 vs 8.1 min. s04 went from
   $0.295/74 s to $0.575/161 s, and s11 from $0.202/51 s to $0.387/140 s. Both passed in run 1
   without a Critic. On this day the Critic changed one thing, the s11 tag order. That is the
   expected price of fixes 6 and 7. Whether it pays needs a day where the Builder gets something
   wrong.

Not found: no crashes, stuck runs or rate limits. No session was stopped at its cap. No Builder
pushed. The GitHub stub saw 3 requests per run, all with the bench's fake token ("foreign
credentials: none"). `gh auth status` under the stack's env returned "You are not logged into
any GitHub hosts". The GitHub connection was "active token; gh CLI login none", from the memory
secret store (the keychain's `github:token` is never read). The feature-web-apps original was
unchanged (s14 `originalUntouched`).

## Bench changes (committed on `bench/dev-day-rerun`)

- `--day-level <ask|askBeforeEdits|autoEdit|fullAuto>` plays the harness's default-level sessions
  at another level and records it in the run's setup. This rerun used `--day-level autoEdit`.
- The Balanced user answers the plan-only card with "Approve plan". The risky card was already
  answered with "Build it".
- Scoring (`score.ts`, `sessions.ts`), both re-scored with `rescore-day.ts`:
  - Options written as "Pro:" / "Con:" bullets, or "a few ways to…", count as options. The
    rerun's s02 at Ask before edits had been scored as a plan. A test was added in `score.test.ts`.
  - s07's check for the plural() bug accepts "singular". The Auto-edit Critic wrote "`count <= 1`
    makes zero singular… '0 turn'".
  - Re-scoring run 1 with the new scorer changes no verdict. The only difference is s14, because
    that file has its replies removed.

Checked before the live runs: `--selftest` passed 14/14. A fake dry run of the harness at Ask before
edits ran all 14 sessions: plan card and auto-saved plan on s03, Critic on s04 and s07, risky card
first on s10, a draft PR on the stub on s12. A fake dry run at Auto-edit covered s04–s06, s10 and
s11: no keep-card interventions, risky card on s10 and s11.

## Which conclusions are weak

- **Rankings**: n = 1. The harness at Ask before edits and direct Claude both pass 14/14. The
  cost gap ($1.36 vs $0.40 per pass) comes almost entirely from interventions (10 vs 2), and the
  intervention count is the same from run to run, so that gap is sturdier than the pass rates.
- **Auto-edit's two failures**: N1 has a gate log that would reproduce without resampling
  (`askAt 0` at hands-off). Strong. N2 depends on what the Critic finds and how Jev reads it, and
  Ask before edits' s04 saw similar findings go to the keep card. Medium.
- **The resume fix** is confirmed at the session level only. The partial-edit path needs a Stop
  after the first edit.
- **Cost**: single runs. The +27% at Ask before edits is where the Critic now runs, and it lines
  up with the per-session numbers.

## Reproduce

```sh
export PATH="$HOME/.local/share/node24/bin:$HOME/.local/bin:$PATH"
# TEST_DATABASE_URL = …/spark_outpost_test_devday2 in .local/credentials.env
pnpm e2e:live --blocks dev-day --selftest --dir <scratch>/selftest
AGENT_RUNTIME=fake pnpm e2e:live --blocks dev-day --dir <scratch>/dry --label dry --timeout-min 3 --arms harness
pnpm e2e:live --blocks dev-day --live --arms harness --dir <scratch>/live-abe --label rerun-abe --shots --budget 5
pnpm e2e:live --blocks dev-day --live --arms harness --day-level autoEdit --dir <scratch>/live-auto --label rerun-auto --shots --budget 5
node --import tsx scripts/e2e-live/dev-day/rescore-day.ts <run.json> <out-prefix>
```

## Screenshots

There is one screenshot per harness chat, and they stay out of the repo. They live in the
session scratchpad
`/private/tmp/claude-501/-Users-hmk-Downloads-spark-outpost/de4f337c-37ca-43f6-b4b8-456b09d97ef9/scratchpad/devday2/`
under `live-abe/shots/` and `live-auto/shots/`
(`dev-day-sNN-harness.png`). Useful ones:

- `live-abe/shots/dev-day-s11-harness.png`: the risky card on the tags story, the Critic's concerns
  and the fix round.
- `live-abe/shots/dev-day-s07-harness.png`: the Critic-only review.
- `live-auto/shots/dev-day-s08-harness.png`: "Make it faster." built without asking.
- `live-auto/shots/dev-day-s04-harness.png`: the fix loop that ran out of tool calls.
