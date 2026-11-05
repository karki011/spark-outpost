# Live routing comparison · 2026-09-27

Which model should the Builder run on? This round runs the same coding scenarios live with the Builder on Haiku 4.5, Sonnet 5 and Opus 5.5. It then scores the routing policies against what those runs actually did:

- **rule:** today's rule route. In this setup the rule is "chat model" and the chat model is Sonnet, so rule means the Builder runs on Sonnet every time.
- **Jev text-only:** Jev's route answer from the request alone.
- **Jev with evidence:** Jev's route answer with the code scan's ranked files attached.
- **Jev with evidence ≥ 0.8:** the evidence answer only when its confidence is at least 0.8, otherwise the rule.
- **Fixed tiers:** every task on one model. Fixed Haiku is what a user chatting on Haiku gets today, because the rule route follows the chat model.

The shadow report was [routing-shadow-2026-09-27.md](routing-shadow-2026-09-27.md). Format follows [harness-e2e-lean-2026-09-27.md](harness-e2e-lean-2026-09-27.md). Data: [routing-live-2026-09-27.json](routing-live-2026-09-27.json), produced by `scripts/routing/live-score.ts`.

**Spend:** $6.63 of the $10 cap, over 60 cells. Jev's share was $0.022. Nothing was stopped for budget.

## Setup

- **Stack:** `bench/live-routing` at `1306f37`, `AGENT_RUNTIME=acp`, real Claude and real Jev. The API and worker ran on their own `*_test_*` database with the API on port 4711. Only Claude and Jev were connected, so every Critic is Claude. The block pre-indexes the fixture for the code scan.
- **Driver:** the HTTP API driver at Balanced with Auto routing. Approvals and checkpoints were answered like a Balanced user (`scripts/e2e-live/balanced.ts`), and that user always answers Keep on "Keep these changes?".
- **Variants:** `rule` (chat model Sonnet, so the Builder is on Sonnet), `chat-haiku` (Builder on Haiku) and `chat-opus` (Builder on Opus). A Jev shadow answer was recorded on every run. The Critic, when one ran, was one tier above the Builder: Sonnet for a Haiku Builder, Opus for a Sonnet Builder.
- **Scenarios:** the 16 coding scenarios of the e2e suite (b–t minus the question, destructive, ambiguous and cancel ones), all in the `ledger-lite` fixture. A run passes when the visible suite and the hidden checks both pass.
- **Batches:** probe, pass1, pass2, rep2 and rep2b. rep2b was interrupted after 2 cells and resumed; its 9 remaining cells ran here for $1.49.
- **Repair cost for a failure:** a rerun on the top tier for that scenario plus 10 minutes of the user's time at $60/h. That comes to about $10.1–10.4 per failure. It is an estimate. See "Repair cost" for why it is probably low.

## Headline

1. **Pass rate.** Sonnet passed 32/32 runs and Opus 6/6. Haiku passed 18/22, and all 4 failures were silent. The visible tests and the project checks passed every time, and the Builder told the user "All tests pass."

   | Policy | Pass (scenario-weighted) | Cost / pass | Per task incl. repair | Scenarios | Differs from rule |
   | --- | --- | --- | --- | --- | --- |
   | rule (Sonnet) | **100%** (32/32 runs) | $0.122 | **$0.12** | 16 | — |
   | Jev with evidence | 100%* | $0.113 | $0.11* | 16 | 9 |
   | Jev text-only | 100%* | $0.114 | $0.11* | 16 | 10 |
   | Jev with evidence ≥ 0.8 | 100%* | $0.117 | $0.12* | 16 | 5 |
   | Fixed Haiku | **85%** (18/22 runs; e 0/2, t 0/2) | $0.095 | **$1.66** | 13 | — |
   | Rule on the same 13 | 100% | $0.110 | $0.11 | 13 | — |
   | Fixed Opus | 100% (6/6) | $0.178 | $0.18 | 3 (c h j) | — |
   | Rule on the same 3 | 100% | $0.174 | $0.17 | 3 | — |

   \* Counterfactual. The Jev policies are scored on the runs of the model Jev picked. Jev never picked Haiku for e or t, the only scenarios where Haiku failed, so no Jev policy ran into a failure. Its Haiku picks rest on 14/14 passing Haiku runs over 7 scenarios. With 0 failures in 14 runs, the rule of three still allows a failure rate of up to about 21%.

2. **Cost per pass without repair:** Haiku is 22% cheaper than Sonnet, and the Jev policies are 4–7% cheaper than the rule. **With repair counted, fixed Haiku costs 15× the rule per task** ($1.66 against $0.11). A 2-minute repair would still put it at about 4×.
3. **Jev's savings are too small to justify its risk yet.** Where Jev moves a task to Haiku, it saves about $0.020 per task (b g i k m o p, mean of the Sonnet−Haiku difference). One failure costs about $10. Downgrading only pays off if Haiku fails on fewer than **about 1 in 500** of the tasks Jev sends it (0.2%). 14 runs cannot show that. It would take roughly 1,500 clean runs.
4. **Jev's picks are good and stable.** It kept both Haiku failure scenarios on Sonnet (e: Sonnet 0.53/0.49, t: Sonnet 0.96/0.97). It sent only simple tasks to Haiku (single-file fix, docs, Python, a11y, security header, project check, second turn), and Haiku passed all of those 2/2. Across the two shadow runs of each scenario the pick never changed, and confidence moved by at most 0.05. The text-only and evidence answers disagree only on j (text: Opus 0.50; evidence: Sonnet 0.56).
5. **Opus bought no passes.** Sonnet already passed c, h and j 2/2. Jev's Opus picks all had low confidence (c 0.24–0.30, h 0.53–0.62, j 0.50 text). Opus was cheaper and faster on c ($0.137 / 36 s against $0.163 / 80 s), and slightly dearer on h and j.
6. **Policy gap: the Critic found the bug, but no fix turn ran.** On e (explicit review request) with a Haiku Builder, the Sonnet Critic returned "concerns" both times. Each time it named the exact behavior the hidden check then failed:
   - **Run 1:** the Critic wrote that `"((5.00)"` is accepted because `hasParens` only looks at the first and last characters, and that it should throw. In the kept code `parseCents('((5.00)')` returns `-500`, and the hidden test "rejects parentheses that do not wrap the whole amount" fails.
   - **Run 2:** the Critic reported a "Critical regression": an unconditional `Math.abs` turns `-$50` positive. In the kept code `parseCents('-$5.00')` returns `500`, and the hidden test "keeps ordinary amounts and minus signs working" fails.

   Both times the "Keep these changes?" card came next, the Balanced answer was Keep, and `fixTurns` was 0. The card offers "Ask for a fix", but in Balanced a Critic verdict does not change the answer. The concerns are only printed in the final message. **When the Critic says "concerns" with a concrete correctness finding (a file:line, an input and the wrong output), Balanced should run one fix turn before the Keep card.**

## Per scenario

Pass · mean cost · mean wall. Jev picks are from the first shadow run (turn 1), with the confidence. "probability" means the answer came through the cumulative probability rule, not a direct choice.

| Scenario | Jev text | Jev evidence | Haiku | Sonnet (rule) | Opus |
| --- | --- | --- | --- | --- | --- |
| b · single-file fix | Haiku 0.99 | Haiku 0.98 | 2/2 · $0.032 · 23 s | 2/2 · $0.044 · 27 s | — |
| c · vague multi-module | Opus 0.24 prob. | Opus 0.29 prob. | — | 2/2 · $0.163 · 80 s | 2/2 · $0.137 · 36 s |
| d · two features | Sonnet 0.95 | Sonnet 0.96 | 1/1 · $0.076 · 53 s | 2/2 · $0.155 · 60 s | — |
| e · review request | Sonnet 0.53 prob. | Sonnet 0.49 prob. | **0/2** · $0.217 · 175 s | 2/2 · $0.231 · 244 s | — |
| g · unknown project check | Haiku 0.93 | Haiku 0.94 | 2/2 · $0.052 · 39 s | 2/2 · $0.072 · 32 s | — |
| h · over-build-prone cache | Opus 0.61 prob. | Opus 0.53 prob. | — | 2/2 · $0.064 · 31 s | 2/2 · $0.091 · 23 s |
| i · second turn | Haiku 0.97 | Haiku 0.98 | 2/2 · $0.056 · 45 s | 2/2 · $0.073 · 44 s | — |
| j · build and review | Opus 0.50 prob. | Sonnet 0.56 prob. | — | 2/2 · $0.294 · 103 s | 2/2 · $0.305 · 87 s |
| k · Python project | Haiku 0.82 | Haiku 0.84 | 2/2 · $0.058 · 41 s | 2/2 · $0.070 · 29 s | — |
| l · type errors across files | Sonnet 0.92 | Sonnet 0.91 | 1/1 · $0.088 · 63 s | 2/2 · $0.081 · 30 s | — |
| m · UI + accessibility | Haiku 0.68 | Haiku 0.66 | 2/2 · $0.040 · 29 s | 2/2 · $0.063 · 24 s | — |
| o · security-sensitive | Haiku 0.68 | Haiku 0.73 | 2/2 · $0.037 · 26 s | 2/2 · $0.068 · 25 s | — |
| p · docs only | Haiku 0.71 | Haiku 0.81 | 2/2 · $0.031 · 21 s | 2/2 · $0.054 · 22 s | — |
| q · rename ~10 files | Sonnet 0.89 | Sonnet 0.89 | 1/1 · $0.185 · 84 s | 2/2 · $0.253 · 154 s | — |
| r · follow-up changes plan | Sonnet 0.90 | Sonnet 0.89 | 1/1 · $0.082 · 70 s | 2/2 · $0.134 · 56 s | — |
| t · parallel lanes, one file | Sonnet 0.96 | Sonnet 0.97 | **0/2** · $0.091 · 74 s | 2/2 · $0.130 · 58 s | — |

### The four failures

| Cell | What went wrong | Critic | Fix turns | Kept |
| --- | --- | --- | --- | --- |
| e Haiku #1 | `"((5.00)"` parses to −500 instead of throwing | Sonnet: concerns, named this exact input | 0 | Keep |
| e Haiku #2 | `-$5.00` parses to +500 (regression in the old path) | Sonnet: concerns, "Critical regression", named it | 0 | Keep |
| t Haiku #1 | `daysBetween` off by one (hidden: 0 !== 1). Haiku changed its own test to match | none ran | 0 | Keep |
| t Haiku #2 | same `daysBetween` off-by-one | none ran | 0 | Keep |

The failing hidden tests were reproduced by running the fixture's hidden checks on the kept repos.

### Critic verdicts across the round

The Critic ran on 11 cells and said "concerns" on 4:

- **The 2 failures:** the e Haiku runs above, where it caught the bug both times.
- **2 passing runs:** Sonnet on j (pass1: no test covers the cent-sharing loop) and on e (rep2b: half-cent rounding differs between `-` and `()`, and `(+$5)` is accepted). These are real edge cases, and a fix turn there would have cost roughly one short Builder turn.

It said "looks good" on 7, all of them passes. On this small sample, "concerns → one fix turn" would have fired on both failures and on 2 of 9 passes.

## Repair cost

This round prices a failure at a top-tier rerun plus 10 minutes at $60/h. That is probably low:

- **The failures are silent.** Checks passed, the visible suite passed, and the Builder reported success. A user finds the bug later, in review or production, not at the Keep card.
- **The e failures are in money parsing.** A negative amount read as positive is the kind of bug that costs far more than 10 minutes once it ships.

Even at 2 minutes a failure, fixed Haiku costs about 4× the rule per task. At 10 minutes the Jev downgrade saving ($0.020 a task) is wiped out by one failure every ~500 tasks.

## Files and latency

- **File ranking (32 shadow runs with changes):** mean P/R@5 is 0.38 / 0.72 for the scan order and 0.41 / 0.81 after Jev's ranking. Jev's first file was a changed file in 32/32.
- **Latency:** rank median 256 ms (max 354), text-only route 192 ms (max 299), evidence route 186 ms (max 391).
- **Jev cost:** $0.00037 per task, $0.022 in total.

## How much to trust this

- **n is small everywhere.** Most cells ran twice. Haiku on d, l, q and r ran once. Haiku on c, h and j and Opus on everything except c, h and j were never run. The Opus-vs-Sonnet conclusion rests on 3 scenarios.
- **Strong:** Haiku fails e and t (0/2 each, same failure mode both times, Sonnet 2/2). The Critic catches the e bug (2/2) and no fix turn follows (2/2).
- **Weak:** "Jev policies pass 100%". That is 14/14 Haiku runs on the scenarios Jev downgraded, and it is scored counterfactually from one shadow pick per scenario. The cost gap between Jev and the rule (4–7%) is within run-to-run noise: Sonnet on q cost $0.234 and $0.272.
- **Weak:** "Opus buys nothing". There were 3 scenarios, and Sonnet was already at 100% on them.
- **Limited coverage:** there is one fixture repository (`ledger-lite`) of small TypeScript and Python tasks. Harder or larger tasks may separate Sonnet from Opus, which this round cannot show.
- **The Balanced user is scripted.** It always keeps. A real user who reads the Critic's concerns might ask for a fix. The gap is that nothing in Balanced does this automatically.

## Recommendation

**Switch on:** the rule route with a **Sonnet floor for Builders**. Keep the rule as it is, except that a Do Builder never runs below Sonnet, even when the chat model is Haiku. This is the only change the data supports on pass rate:

- Today a Haiku chat puts the Builder on Haiku, which failed 4/22, all silently.
- Sonnet passed 32/32.
- It costs about $0.02 more per task. Repair makes Haiku 15× dearer.

**Change next:**

1. **Fix turn on Critic concerns in Balanced.** When the Critic's verdict is "concerns" with a concrete correctness finding, run one fix turn with those findings before showing "Keep these changes?". Show Keep as the default only after a "looks good" or after the fix turn. Test it on e with a Haiku Builder: the fix should turn both failures into passes. Expect 2 extra fix turns in 9 passing Critic runs.
2. **Keep Jev in shadow; do not let it act yet.** Its picks are stable, cheap ($0.0004 a task, under 0.4 s) and avoided both Haiku failures. But the saving is about $0.02 a task and the break-even failure rate is about 0.2%, which needs on the order of 1,500 labelled Haiku runs to show. If it acts later, use the evidence variant for downgrades only, at confidence ≥ 0.8. Never downgrade review intent or multi-feature tasks, and require a Critic on every downgraded run so the fix turn above can catch a miss.
3. **Do not act on Jev's Opus picks.** All of them had confidence ≤ 0.62 and gained no passes. Rerun c, h and j on harder tasks before deciding.
4. **Add a Critic, or a stronger check, for multi-feature work (t).** No Critic ran on t. Haiku edited its own test to match an off-by-one, and nothing noticed.

## Reproduce

```sh
export E2E_API_PORT=4711 E2E_RUN_CAP_USD=1.0
node --env-file-if-exists=.local/credentials.env --import tsx scripts/e2e-live/run.ts \
  --live --blocks routing --match '<cells>' --budget <usd> --dir <scratch> --label <batch> --timeout-min 12
node --import tsx scripts/routing/live-score.ts --out docs/benchmarks/routing-live-2026-09-27.json \
  <scratch>/results-{probe,pass1,pass2,rep2,rep2b}.json
```
