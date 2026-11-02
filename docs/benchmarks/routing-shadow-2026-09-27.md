# Routing shadow: live check (2026-09-27)

Rollout step 1 of `docs/architecture/ROUTING_PLAN.md`. For each Do task the harness asks Jev to rank the code scan's candidate files (one Choice), then asks the route question twice: once on the request alone (text-only) and once with the ranked files as code evidence. Both answers are recorded next to the rule route. The Builder ran on the rule route in every task.

Run 1 found a loop-guard bug and a useless rerank. Run 2 is after the fix (`567d642`, the guard judges a tool call by its final input) and with the rerank removed.

## Run 2 (guard fixed, checks on)

- **Repository:** a fresh throwaway clone of `orders-web-app`, origin removed. The original was not touched.
- **Stack:** branch `feat/jev-route` at `fb17e2e` plus the driver fix below, `AGENT_RUNTIME=acp`, real Claude, real Jev (`jev-1.13.0`), fresh schemas in `spark_outpost_test_route`, the production worker with the loop guard on, Full auto, Auto routing, only Claude and Jev connected. Candidates offered to Jev: Haiku 4.5 (low), Sonnet 5 (mid), Opus 5.5 (top), plus `uncertain`.
- **Checks:** the project's own `check` script needs `pnpm install`, and every tarball in its lockfile comes from a private registry (private package hosts), so no dependencies could be installed. The check used is the Biome part of that script, `biome check libs apps/web/src` (Biome 2.4.16 installed separately; 2 s, the baseline passes with warnings only). There are no tests, typecheck or ESLint: checks here catch lint and format errors, not wrong behaviour.
- **Chat model:** task 1 ran on Sonnet 5 and cost $1.27 in one ten-minute turn (see the cap below). To finish more tasks within $3, tasks 2–9 ran with Haiku 4.5 as the chat model, so the rule route is Haiku there and the cumulative rule's baseline tier is low.
- **Tasks:** requests 1–9 of `scripts/codescan/requests.ts` (the rename was not reached). Task 9 was cancelled 1 s after it started, because the budget required it; it ran on anyway (see below). Tasks 2–8 are the 7 complete tasks.
- **Spend:** $2.90 agent cost as recorded and $0.011 Jev. One more run, cancelled 30 s in, records $0, so the true total is slightly higher.

| #   | Request (short)                  | Status    | Changed | Scan P/R@5 | Jev P/R@5 | Rule   | Jev text-only       | Jev with evidence   | Check (Biome) | Keep | Verifier | Agent $ |
| --- | -------------------------------- | --------- | ------: | ---------- | --------- | ------ | ------------------- | ------------------- | ------------- | ---- | -------- | ------: |
| 1   | useTableSort empty rows     | cancelled |       0 | —          | —         | Sonnet | Haiku · choice 0.74 | Sonnet · cumul. 0.48 | —            | —    | —        |   1.267 |
| 2   | SearchField dense prop         | succeeded |       2 | 0.20/0.50  | 0.40/1.00 | Haiku  | Sonnet · choice 0.76 | Sonnet · choice 0.86 | passed       | kept | pass     |   0.139 |
| 3   | formatShortNumber rounding   | succeeded |       2 | 0.20/0.50  | 0.40/1.00 | Haiku  | Haiku · choice 0.93 | Sonnet · cumul. 0.58 | passed        | kept | pass     |   0.100 |
| 4   | formatRange year boundary    | succeeded |       1 | 0.20/1.00  | 0.20/1.00 | Haiku  | Haiku · choice 0.83 | Sonnet · cumul. 0.52 | passed        | kept | pass     |   0.509 |
| 5   | Invoices import error toast       | succeeded |       2 | 0.00/0.00  | 0.40/1.00 | Haiku  | Haiku · choice 0.92 | Haiku · choice 0.71  | passed        | kept | pass     |   0.119 |
| 6   | useFlag returns false     | succeeded |       1 | 0.20/1.00  | 0.20/1.00 | Haiku  | Opus · cumul. 0.59  | Opus · choice 0.93   | passed        | kept | flag     |   0.107 |
| 7   | createApiClient retry on 401 | succeeded |       2 | 0.20/0.50  | 0.40/1.00 | Haiku  | Sonnet · cumul. 0.31 | Sonnet · choice 0.69 | passed       | kept | pass     |   0.115 |
| 8   | TrendLine showAxis, StatTile    | succeeded |       2 | 0.40/1.00  | 0.40/1.00 | Haiku  | Sonnet · cumul. 0.36 | Sonnet · choice 0.76 | passed       | kept | pass     |   0.104 |
| 9   | Prefetch charts on hover      | cancelled |       7 | 0.40/0.29  | 0.40/0.29 | Haiku  | Sonnet · cumul. 0.33 | Sonnet · choice 0.77 | —            | —    | —        |   0.441 |

No Critic ran and no task escalated. "Verifier" is the observed Jev diff check; "flag" means it would have flagged the change. No thumbs were given.

### Files

- Over the 7 complete tasks, mean P/R@5 is **0.20 / 0.64 for the scan order and 0.34 / 1.00 after Jev's ranking**. Jev's five files contained every changed file in all 7; the scan's did in 4.
- Jev's first file was changed in 6 of 7 (it chose the invoices page in task 5, where the Builder edited the import panel and the upload modal, Jev's 3rd and 2nd); the scan's first file in 5 of 7.
- Precision is capped by how few files a task changes (1–2 here), so 0.40 is the best possible for a two-file change.

### Routes

- All 7 complete tasks passed their check and were kept on the rule's route (Haiku). Evidence said Sonnet for 5 of them (2, 3, 4, 7, 8) and Opus for task 6; text-only said Sonnet for 3 and Opus for 1. With only a lint check, these passes do not show that Haiku's changes are correct, so they neither confirm nor refute Jev's picks.
- Task 6 is the one disagreement with an outcome signal: Jev with evidence said Opus (0.93) and the verifier flagged Haiku's change. One case is not evidence.
- The pattern from run 1 holds: the evidence moves probability from Haiku to Sonnet (all 8 tasks where text-only gave Haiku any probability) and the evidence answers are more often accepted at confidence ≥ 0.65 (6 of 9 against 5 of 9).

### Latency and Jev cost

Ranking median 503 ms (max 678), text-only route 213 ms (max 265), evidence route 176 ms (max 219). Jev cost about $0.0012 per task.

### Notes (not fixed)

- **The per-run cost cap overshoot reproduces.** Capped at $0.35, task 1 cost $1.27 (one Sonnet turn of ten minutes that downloaded and read charting library sources) and task 4 cost $0.51. The cost only arrives at the end of a turn, so a long single turn is never stopped by the cap.
- **The ignored cancel reproduces when the cancel comes before the Builder starts.** Task 9 was cancelled at 19:23:23; its Builder started at 19:23:24 and ran until 19:26:57 ($0.44, 7 files changed). Repeated cancel requests did not stop it. A cancel of a running Builder (task 1) stopped it within 4 s.
- **Driver bug, fixed:** `Api.cancel` in `scripts/e2e-live/api-driver.ts` sent no JSON body, and the API rejected it silently, so earlier e2e-live timeouts never cancelled. It now sends `{}`.

### Reproduce

```sh
git clone <private repo clone> /tmp/private-repo && git -C /tmp/private-repo remote remove origin
node --import tsx scripts/routing/live.ts --repo /tmp/private-repo --out routing-live.json \
  --limit 9 --model haiku --timeout-min 5 --run-cap 0.35 --total-cap 1.3 \
  --check "/path/to/biome check libs apps/web/src"
pnpm routing:labels --out labels.json
```

## Run 1 (guard bug)

This run used the two-stage ranking (a rerank Choice over a shortlist), since removed, and the loop guard before `567d642`.

- **Repository:** a throwaway local clone of `orders-web-app` (5,443 tracked files, 5,426 indexed), origin removed. The original was not touched.
- **Stack:** API and worker from branch `feat/jev-route`, `AGENT_RUNTIME=acp`, real Claude (Claude Code login), real Jev (`jev-1.13.0`), a fresh schema in `spark_outpost_test_route`. Chat model Sonnet 5 on Auto, Full auto, build style off, no check commands, only Claude and Jev connected. Candidates offered to Jev: Haiku 4.5 (low), Sonnet 5 (mid), Opus 5.5 (top), plus `uncertain`.
- **Requests:** the ten `orders-web-app` requests in `scripts/codescan/requests.ts`, the rename moved last. One new chat per request. Driver: `scripts/routing/live.ts`.
- **Spend:** $2.84 of agent cost as recorded (including a one-task trial) and $0.014 of Jev, under the $3 limit. Two cancelled runs record no cost, so the real agent spend is slightly higher.

### What happened to the tasks

The outcomes are not usable as quality labels, and nothing below judges whether a route was right.

- **Tasks 1–5 ran on the production harness.** The loop guard stopped the Builder in all of them: "Bolt repeated `Terminal` 5 times in a row". The clone has no `node_modules`, so the Builder searched for library types with shell commands, and every Bash call reaches the guard under the same name, `Terminal`, whatever the command. Task 5 finished its edit before the guard; task 2 edited 3 files first.
- **Tasks 6–10 ran with the loop guard off** (a benchmark-only worker entry, since removed). Tasks 6 and 7 ended at the per-run cost cap after editing.
- **Tasks 8–10 were cancelled as soon as the shadow route was recorded,** to stay under $3. Tasks 8 and 9 stopped. Task 10's cancel was requested 7 s in, but its Haiku Builder kept running for 5 minutes, renamed the component across 19 files and cost $0.64.
- **Files actually changed** come from the clone's git diff after each task (committed between tasks). Five tasks changed files: 2, 5, 6, 7 and 10.

### Results

P/R@5 is precision and recall of the first five predicted files against the files the task changed. "Scan" is the code scan's own order. "Final" is the stage-2 order of the shortlist followed by the rest of stage 1. Route cells show the pick, how it was accepted (choice: confidence ≥ 0.65; cumulative: the cheapest tier reaching 0.8), and the confidence.

| #   | Request (short)                    | Changed | Scan P/R@5 | Final P/R@5 | Rule     | Jev text-only        | Jev with evidence     |
| --- | ---------------------------------- | ------: | ---------- | ----------- | -------- | -------------------- | --------------------- |
| 1   | useTableSort empty rows       |       0 | —          | —           | Sonnet 5 | Haiku · choice 0.81  | Sonnet · cumul. 0.57  |
| 2   | SearchField dense prop           |       3 | 0.20/0.33  | 0.20/0.33   | Sonnet 5 | Sonnet · choice 0.76 | Sonnet · choice 0.86  |
| 3   | formatShortNumber rounding     |       0 | —          | —           | Sonnet 5 | Haiku · choice 0.95  | Sonnet · cumul. 0.56  |
| 4   | formatRange year boundary      |       0 | —          | —           | Sonnet 5 | Haiku · choice 0.77  | Sonnet · cumul. 0.43  |
| 5   | Invoices import error toast         |       2 | 0.20/0.50  | 0.20/0.50   | Sonnet 5 | Haiku · choice 0.92  | Haiku · choice 0.66   |
| 6   | useFlag returns false       |       2 | 0.20/0.50  | 0.20/0.50   | Sonnet 5 | Opus · cumul. 0.59   | Opus · choice 0.93    |
| 7   | createApiClient retry on 401   |       2 | 0.20/0.50  | 0.40/1.00   | Sonnet 5 | Sonnet · cumul. 0.37 | Sonnet · choice 0.66  |
| 8   | TrendLine showAxis, StatTile      |       — | —          | —           | Sonnet 5 | Sonnet · cumul. 0.43 | Sonnet · choice 0.73  |
| 9   | Prefetch charts on hover        |       — | —          | —           | Sonnet 5 | Sonnet · cumul. 0.39 | Sonnet · choice 0.76  |
| 10  | Rename StatTile → MetricTile        |      19 | 0.80/0.21  | 0.80/0.21   | Haiku 4.5 | Sonnet · choice 0.84 | Sonnet · choice 0.82 |

#### File ranking

- **Top file.** Jev's first file was a changed file in 4 of the 5 tasks with changes (2, 6, 7, 10); the scan's first file in 3 (6, 7, 10). In task 2 the scan put an unrelated link helper first and Jev put the edited search field component first. In task 5 both missed: Jev chose the invoices page, the Builder edited the import panel (Jev's third file).
- **P/R@5, mean over the 5 tasks:** scan 0.32 / 0.41, final 0.36 / 0.51. Stage 1 alone gives probability to only 1–4 files, so its own @5 numbers (0.61 / 0.49) come from shorter lists and are not comparable.
- **Stage 1 is very peaked.** The top file got 0.81–1.00 in 7 of 10 tasks. The shortlist was therefore usually the minimum of 3 files.
- **The rerank added nothing.** Stage 2 kept stage 1's top file in all 10 tasks. Where it reordered the rest it moved a changed file down twice (task 5: the import panel from 3rd to 4th; task 7: the new test from 2nd to 3rd) and never moved one up. Recommendation: record stage 1 only, and use per-file Nouls if a multi-file answer is needed (a Choice spreads one unit of probability, so the second changed file gets almost none).

#### Route question

- **Evidence moves routes up.** With the code evidence, Haiku lost probability in all 9 tasks where text-only gave it any. Text-only picked Haiku in 5 tasks; with evidence only task 5 stayed Haiku. In tasks 1, 3 and 4 the evidence answer was split (confidence 0.43–0.57) and the cumulative rule took Sonnet.
- **Agreement with the rules:** with evidence 7 of 10 (differs on 5: Haiku, 6: Opus, 10: Sonnet where the trivial rule chose Haiku for the rename); text-only 4 of 10.
- **Accepted at confidence ≥ 0.65:** text-only 6 of 10, with evidence 7 of 10. The other answers went through the cumulative rule; none was uncertain.
- **Task 10** is the plan's example: the rule's `TRIVIAL_VERB` sends "Rename …" to Haiku, both Jev variants said Sonnet, and the rename touched 19 files in 3 packages.
- Whether any of these picks is better cannot be told from this run: no checks ran and most Builders were stopped by the loop guard, the cost cap or a cancel.

#### Latency and cost (per task, 10 tasks)

| Call                     | Median  | Max    | Input tokens |
| ------------------------ | ------- | ------ | ------------ |
| Rank stage 1 (≤255 opts) | 530 ms  | 671 ms | 16,500–20,800 |
| Rank stage 2 (3 opts)    | 171 ms  | 205 ms | 850–1,090    |
| Route, text-only         | 219 ms  | 515 ms | 1,293–1,313  |
| Route, with evidence     | 191 ms  | 242 ms | 1,907–2,090  |

- Stage 1, stage 2 and the evidence route run one after another after the scan (1.2 s in the trial task), so the evidence answer lands about 1 s after the scan. The text-only route runs beside the ranking.
- Jev cost about $0.0011 per task, about 85% of it stage 1.

### Limits

- 10 tasks, one repository, one run each, one engineer's requests. No labels of the right tier, so no accuracy is claimed.
- Only five tasks changed files, and all of those stopped early (loop guard, cost cap, or an ignored cancel), so "files changed" undercounts what a finished task would touch.
- The per-run cost cap overshot: runs capped at $0.18–0.30 cost $0.42–0.46, because the cost arrives at the end of a turn.
- Tasks 6–10 ran without the loop guard, which is not the production harness.

### Found along the way (not fixed here)

1. The loop guard treats every Claude Bash call as the same action (`Terminal`), so five different shell commands in a row stop a Builder.
2. A cancel requested while the Builder was starting did not stop it (task 10).
3. Cancelled runs record $0 (already noted in the lean benchmark).

### Reproduce (run 1)

```sh
git clone <private repo clone> /tmp/private-repo && git -C /tmp/private-repo remote remove origin
node --import tsx scripts/routing/live.ts --repo /tmp/private-repo --out routing-live.json --limit 10 --run-cap 0.18 --total-cap 1.2
pnpm routing:labels --out labels.json   # against DATABASE_URL, or --search-path for a live schema
```
