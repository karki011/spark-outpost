# Spark Outpost usage-history audit (local dev DB, read-only)

Date: 2026-09-28. Source: `DATABASE_URL` from `.local/credentials.env`; every query ran inside `BEGIN READ ONLY; SET TRANSACTION READ ONLY; … ROLLBACK`. No writes, no model calls. Helper: `scratchpad/q.sh`, `scratchpad/qa.sh`.

## Headline

1. **The dataset is too small to tune Jev.** The DB was created 2026-09-25 11:05 (first migration) and holds 3 days: 47 conversations, 50 user messages, 57 runs (7 child), 57 `run_advice` rows. After removing fake-provider smoke tests, scripted live-e2e runs and digests, **11 human task turns** remain (Do/Ask on a real or fixture repo), plus about 10 "hi"/test chats. Only **4 intakes ran under a current policy** (`cascade-2` ×3, `floor-1` ×1). Every rate below is an anecdote, not a statistic. The TypeSafe finding (label strong, item-pick weak; ≥0.7 safe) can be neither confirmed nor refuted from this history.
2. **The clearest real failure: vague follow-ups in Do.** Two follow-ups sent to a Builder ("wrap up", "any feedback") were not first messages, so the `vague` question never ran. Jev's `question` Noul sat in the middle band (0.36) and hands-off/rules fell back to "build". Both Builders replied that the request was too vague and they needed clarification. Together they cost about $0.19 including a pointless tier-up retry. Jev's intent label was right for "any feedback" (review 0.63).
3. **"Answer, or change the code?" was answered "Just answer" 3/3 times** (including the older "How should this be handled?" card). Each was the first option, taking 3–18 s. In all 3 the request was planning or summarising ("lets plan …", "give me plan …", "details summary …"). Jev's `question` Noul was 0.52 and 0.38 on the two recent ones, so it under-calls "yes, answer" for planning or feedback requests.
4. **Permission cards are all "Yes".** Edit 9/9 allow-once, execute 4/4 allowed, "Keep these changes?" 4/4 Keep, plan approve 1/1. Most of these came from scripted runs (1–2 s latency). Human-only: 6 cards, 100% default.
5. **Harness gaps showed up that are not Jev problems.** (a) The working directory changed mid-conversation and both following turns failed. (b) Effort picks are silently dropped for Haiku (26 "Using Claude's default effort; … isn't offered" steps). (c) Provider sessions are almost never resumed: 22 fresh-with-recall starts vs 1 resume. (d) The outcome labels feeding `jev:thresholds` are polluted by smoke tests.
6. **Jev is effectively free:** $0.0029 for 29 answered calls (69.5k input tokens), about 0.2% of the $1.49 agent spend. Median latency is 361 ms for intake and 266 ms for rank. There is no cost reason to ask fewer questions, only a friction reason.

## 1. Volume

| Slice                                              | Runs   | Cost USD                                 | Tokens                  |
| -------------------------------------------------- | ------ | ---------------------------------------- | ----------------------- |
| Human task turns (Do/Ask)                          | 11     | 0.640                                    | 351k                    |
| Human "hi"/test chats                              | 10     | 0.186                                    | 87k                     |
| Scripted live-e2e (1–2 s approvals, fixture repos) | 13     | 0.532                                    | 248k                    |
| Digests (auto)                                     | 5      | 0.128                                    | 46k                     |
| Fake-provider smoke                                | 11     | 0                                        | –                       |
| **All (incl. children)**                           | **57** | **1.486** (claude+zai; codex unreported) | 1.04M (677k cache-read) |

By day: 09-25 15, 09-26 34, 09-27 4, 09-28 4.

Runs by mode/role/model (non-fake, used model):

| mode       | role      | model/effort                  | n     | cost                                                                 |
| ---------- | --------- | ----------------------------- | ----- | -------------------------------------------------------------------- |
| do         | builder   | haiku low / medium            | 4 / 2 | 0.076 / 0.030                                                        |
| do         | builder   | sonnet medium / low           | 3 / 1 | 0.225 / 0.073                                                        |
| ask        | scout     | sonnet low/medium             | 6     | 0.218                                                                |
| ask        | scout     | opus[1m] medium               | 1     | **0.193** (most expensive single run: "tell me more about his repo") |
| ask        | scout     | haiku low                     | 1     | 0.039                                                                |
| ask        | architect | opus[1m] high                 | 1     | 0.145                                                                |
| chat       | digest    | haiku low / sonnet low        | 4 / 1 | 0.129                                                                |
| chat       | scout     | glm-5.3 high (zai)            | 1     | 0.003                                                                |
| (pre-mode) | –         | sonnet/haiku/codex gpt-6-luna | 19    | 0.356 + codex unknown                                                |

Jev calls by purpose: intake 15 (answered), transition 9 (answered, removed in round 10), rank 3 answered + 1 not asked, route 1 answered + 19 not asked, route_shadow 1 answered + 3 not asked, scan 4, plan_agreed 1 (observation). Total Jev: $0.0029, 69.5k tokens.

## 2. Jev intake decisions

### All 15 intakes (policy version; human = H, scripted = S)

| When        | pv        | Who | Request (snippet)             | intent (conf)                       | question    | review  | destr. | Gate                       | What happened                                                           |
| ----------- | --------- | --- | ----------------------------- | ----------------------------------- | ----------- | ------- | ------ | -------------------------- | ----------------------------------------------------------------------- |
| 09-26 05:06 | –         | S   | Rename fmt…                   | refactor .99                        | –           | –       | –      | act                        | built, kept                                                             |
| 09-26 05:07 | –         | S   | Move the date formatting…     | refactor 1.0                        | –           | –       | –      | act                        | plan→4 builders, kept                                                   |
| 09-26 07:29 | –         | H   | add simple test               | feature 1.0                         | –           | –       | –      | act                        | built, kept                                                             |
| 09-26 07:31 | –         | H   | remove it for now the test    | fix .60                             | –           | –       | –      | act                        | built, kept                                                             |
| 09-26 07:38 | –         | H   | give me details summary…      | explain .84                         | –           | –       | –      | ask                        | clarify card → Just answer                                              |
| 09-26 09:13 | –         | H   | show me date formatter        | **feature .67** (really a question) | –           | –       | –      | act                        | Ask; wrong cwd, failed                                                  |
| 09-26 10:40 | –         | S   | what does formatDay return…   | question .99                        | –           | –       | –      | act                        | answered                                                                |
| 09-26 11:39 | –         | H   | wrap up                       | chat .55                            | –           | –       | –      | fallback→build             | Builder "blocked" → retry Sonnet → "needs you" → user Finish            |
| 09-26 11:43 | –         | H   | ask me to read some file      | research .78                        | –           | –       | –      | act                        | answered (asked which file)                                             |
| 09-26 22:34 | –         | H   | tell me more anout his repo   | question .43                        | –           | –       | –      | fallback                   | answered                                                                |
| 09-26 23:13 | –         | H   | hi                            | chat 1.0                            | –           | –       | –      | act                        | chat                                                                    |
| 09-27 20:32 | cascade-2 | H   | tell me more about his repo   | question .48                        | **.89 act** | .06     | .03    | act                        | answered in place (Opus, $0.19)                                         |
| 09-27 20:35 | cascade-2 | H   | lets plan … agent md          | docs .92                            | .52 mid     | .05     | .03    | ask                        | "Answer, or change?" → Just answer (7 s)                                |
| 09-27 20:37 | cascade-2 | H   | give me plan we can integrate | feature .66                         | .38 mid     | .05     | .12    | ask                        | "Answer, or change?" → Just answer (3 s); thumbs up; user saved as plan |
| 09-28 01:40 | floor-1   | H   | any feedback                  | review .63                          | .36 mid     | .40 mid | .04    | fallback→build (hands-off) | Builder: "too vague… need clarification", $0.10                         |

`vague`, `continues_task` and `injection` were never asked in any stored intake. `plan_agreed` was asked once (0.42).

### Confidence bands

Noul values under current policies (4 intakes, 13 values):

| Band                             | n   | Values                                            |
| -------------------------------- | --- | ------------------------------------------------- |
| yes ≥ 0.8 (act)                  | 1   | question .89                                      |
| middle 0.2–0.8 (ask / fall back) | 5   | question .52/.38/.36, review .40, plan_agreed .42 |
| no ≤ 0.2 (act "no")              | 7   | review ×3, destructive ×4                         |

Intent Choice confidence (all 15): ≥0.8: 7; 0.6–0.8: 5; <0.6: 3. Tier Choice (observed only): 0.40, 0.44, 0.56, 0.21, never above 0.6. route_shadow answered once: "uncertain" at 0.78.

The act/confirm bands (≥0.8 act, 0.6–0.85 confirm) cover: intent 7 act, 5 confirm, 3 below.

### Accuracy proxies (my judgement against what the user did next; tiny n)

| Question                   | Evaluable | Agrees with user behaviour                                                      | Notes                                                                                                                                                                                                   |
| -------------------------- | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| intent (label)             | 11 human  | about 8/11; all 4 human ≥0.8 correct                                            | Errors were all <0.7: "show me date formatter" → feature .67; "remove it … the test" fix .60; "wrap up" chat .55 (debatable). Consistent with "label is strong, ≥0.7 safe".                             |
| question (answer in place) | 4         | 1/4 confident and right; 3/4 mid-band where the user wanted an answer each time | Systematic under-call on planning/feedback phrasing. Leaning-wrong at .38 and .36.                                                                                                                      |
| review                     | 4         | "any feedback" .40 was arguably a yes (missed); others correctly low            | n=1 positive                                                                                                                                                                                            |
| destructive                | 4         | 4/4 correctly low                                                               | no positives, recall unmeasurable                                                                                                                                                                       |
| plan_agreed                | 1         | agrees with rule (false); the plan had already been saved by the user           |                                                                                                                                                                                                         |
| tier / route_shadow        | 4 / 1     | uninformative (≤0.56; "uncertain")                                              | For the Opus-routed $0.19 Ask, Jev's tier said small (.40). The user then switched the chat to Sonnet ("Fresh session (settings changed)"). Weak evidence that the rule's "chat model" route overspent. |

**Would acting at 0.7 have been safe?** There is no evidence either way. No `question`/`review`/`destructive` value fell in 0.7–0.8. For intent the only 0.7–0.8 value (research .78) was acceptable. Dropping the act line to 0.7 would not have changed a single decision in this history.

**Would a lower "yes" line for `question` have helped?** At ≥0.5 it would have turned 1 of 3 cards (0.52) into answer-in-place. It would not have fixed the .38 or .36 cases. Those look like phrasing or definition problems ("plan", "feedback" read as "work to do"), not threshold problems.

## 3. Cards and interventions

| Kind                         | Cards | Human | Answered with first/default option | Median human response | Notes                                                  |
| ---------------------------- | ----- | ----- | ---------------------------------- | --------------------- | ------------------------------------------------------ |
| edit (allow once)            | 9     | 1     | 9/9 Yes                            | 18 s                  | mostly scripted                                        |
| execute                      | 4     | 3     | 4/4 Yes (2 scoped to project)      | 5 s                   |                                                        |
| accept "Keep these changes?" | 4     | 2     | 4/4 Keep                           | 9 s                   | no Revert, no "Ask for a fix"                          |
| plan approve                 | 1     | 0     | 1/1 Approve                        | –                     |                                                        |
| clarify (answer vs change)   | 3     | 3     | **3/3 "Just answer"**              | 7 s                   | the purest friction                                    |
| retry (tier up)              | 2     | 2     | 1 Retry, then 1 Finish (71 s)      | –                     | both on the vague "wrap up"; escalation could not help |

Per human task turn: 11 turns, 12 cards, about 1.1 cards per turn. No card timed out or auto-continued (`auto_continue_at` never set).

Always-same-answer kinds: clarify answer/change (3/3), Keep (4/4), edit allow (9/9). Only the clarify card is both human-attended and always the same. The Keep/edit evidence is dominated by scripted runs.

## 4. Failures and stops

- Run status: 52 succeeded, 5 cancelled. All 5 cancelled runs are fake-provider smoke tests ("First line second line"). No failed runs, no job retries (57 jobs, max attempts 1).
- Loop guard, budget, watchdog: none tripped. `orchestrations.exceeded` is null on all 15. Max active time was 70 s against a 900 s limit, max tool calls 20 against 60. `cost_cap_usd` is null everywhere, so no cap was configured.
- Reverts: 0 (`reverted_at` null, no `reverted` signal).
- Thumbs: 2 up (a "hi" chat and "give me plan we can integrate"), 0 down, 0 comments or reasons.
- Soft failures that the status column does not show (all human turns):
  - `wrap up` (Do): Builder "blocked", retry one tier up still "needs you". It ran in `/Users/hmk/Documents/spark-outpost` while its recalled history described work in the `live-crew` fixture.
  - `show me date formatter` (Ask): the agent said "no src/dates.ts". Same cause: the cwd moved from `live-crew` to the real repo between turns in the same chat.
  - `any feedback` (Do, hands-off): Builder said "too vague". Status is succeeded, outcome verdict "unclear".
- Outcome labels: 45 `task_outcomes` (good 32, bad 10, unclear 3). All 10 "bad" come from `cancelled` or `re_ask` on smoke or scripted replays. `re_ask` fired on identical scripted prompts across different chats, and once across a 22-hour gap (similarity 0.67). 31 `quiet_24h` "good" signals also land mostly on smoke tests. **As labels for `jev:thresholds`, most of these rows are noise.**

## 5. Routing, cascade, Critic

- Route decisions (20 rows): pinned 8, rules 4, jev 7 (pre-round-10 acting), fixed 1 (architect top tier), "one tier up" 1. Current policy: 4 routes, 3 pinned and 1 rule "chat model · top tier" (Opus).
- route_shadow vs rule: 4 rows, 1 answered (uncertain .78 → chat model, same as rule), 3 not asked because pinned or no code scan. **No disagreement to evaluate.**
- Builders actually used: Haiku 6 (low/medium), Sonnet 5, no Opus builder. The architect ran once on Opus high ($0.145).
- Cascade / verify: **0 `verify` rows**, 0 Critic reviews (`run_artifacts` has only 4 plan versions), 0 check artifacts. The only escalation was the pre-round-10 "one tier up" on the vague "wrap up", which was wasted.
- "Critic findings preceded reverts": not measurable (0 findings, 0 reverts).

## 6. Rank (file prediction) vs files changed

- Rank answered 3 times. **None of those runs changed files** (two became answer-only, one Builder made no edits), and `task_outcomes.kept` is empty for all of them. P/R@k against changed files: **n = 0**.
- Proxy, files the agent then read: "lets plan … agent md" predicted AGENTS.md at 0.97 (confidence 0.96), and the agent read AGENTS.md: hit@1. "give me plan we can integrate" had confidence 0.18 and top-1 run-metadata.ts; the agent read package.json and globbed docs, so miss@12. "any feedback" had confidence 0.46 and the agent only ran git log: miss.
- That is 1/3 hit, with the hit at high confidence and misses at low confidence. This is directionally consistent with "calibrated, weak at item pick", but it is not evidence. Rank also runs on turns that end up answer-only, which spends tokens where there is nothing to score.

## 7. Plans

- `plan_agreed`: 1 observation (0.42, rule false, `alreadySaved` true, action none). It is consistent with the keyword baseline, but n=1.
- `plan_documents`: 1, saved by the user from an Ask reply and approved (`approved_option` null). Four more plan versions exist as `run_artifacts` from the scripted plan_execute run, approved 1/1.

## 8. Other notes

- **Sessions:** 22 "Recalled N earlier messages" (fresh session plus history replay) vs 1 "Continued session" (`session/resume`) and 1 "Fresh session (settings changed)". Provider sessions close on a 30-minute idle timer, so almost every human turn starts cold.
- **Effort dropped:** the Claude ACP agent does not offer effort for Haiku. 26 step events say the requested low/medium effort was ignored, so Jev and rule effort picks for Haiku are no-ops.
- **Context:** the peak was 9.5% (Haiku 19k/200k). Sonnet/Opus runs show `context_size` 1,000,000 with a 7–22k peak, far from any limit.
- **Slow steps:** "Preparing file…" (Write) averages 11.8 s, max 21.2 s. Terminal averages 6.7 s. Everything else is under 3 s. There are no repeated-tool loops; the most is 6 Read File calls in one run.
- **Latency:** queue is about 0 s. Human Ask turns take 4–28 s end to end. Jev adds about 0.2–0.7 s per call.
- **Codex cost** is not reported (4 runs have null cost and no `cost_source`).
- `followed_instructions` is null on all 57 runs. `runs.requested_mode` is null on all runs, so a Do request converted to Ask cannot be told apart from a turn the user started in Ask.

## Prioritized harness improvements

| #   | Change                                                                                                                                                                                                                                                 | Evidence                                                                                | Confidence                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **Ask `vague` on every Do turn, not just first messages.** Mid-band `question` in Do should not fall back to "build"; fall back to answer-in-place with a one-click "Make the change", or clarify. At hands-off, prefer the cheap, reversible reading. | "wrap up" and "any feedback": both Builders said too vague; $0.19 wasted incl. a retry  | Medium (n=2, same pattern twice, and the Builder's own words) |
| 2   | **Replace the "Answer, or change the code?" card with default-answer plus an inline "Make the change" button**, at least when intent ∈ {question, research, review, docs, explain} or the text has plan/feedback wording.                              | 3/3 cards picked "Just answer"                                                          | Low–medium (n=3)                                              |
| 3   | **Fix the `question` Noul wording** so planning or feedback requests ("let's plan X", "give me a plan", "any feedback") count as answer-only; add them to the labelled set.                                                                            | .52 / .38 / .36 on requests the user wanted answered                                    | Low (n=3); check against the TypeSafe set first               |
| 4   | **Do not retry one tier up when a Builder reports `blocked` / `needs_you` for missing context.** Route to clarify instead.                                                                                                                             | "wrap up": Sonnet retry repeated Haiku's answer; user stopped the Opus retry after 71 s | Medium (the mechanism is clear)                               |
| 5   | **Detect a cwd/project change inside a conversation** and warn, or drop recalled history that refers to the old tree. Store the cwd/project on `runs`.                                                                                                 | 2/2 turns after the switch failed (apology, "blocked")                                  | Medium                                                        |
| 6   | **Clean the outcome labels before tuning thresholds:** exclude `provider='fake'` and scripted e2e (tag runs with a `source`), make `re_ask` same-chat or within N minutes, and don't let `quiet_24h` alone make "good".                                | 10/10 "bad" and most "good" rows come from tests                                        | High                                                          |
| 7   | **Only run `rank` after the intake decides build** (or score it against files read as well as files changed).                                                                                                                                          | 3/3 rank calls landed on turns with no file changes                                     | Medium                                                        |
| 8   | **Surface dropped effort**: don't let Jev or rules pick an effort the agent can't apply, or record `used_effort` as "default".                                                                                                                         | 26 "default effort" steps on Haiku                                                      | High                                                          |
| 9   | **Resume provider sessions longer** (idle close is 30 min) or measure the replay cost.                                                                                                                                                                 | 22 fresh+recall vs 1 resume                                                             | Low (cost impact small with caching; 677k cache-read tokens)  |
| 10  | **Keep acting thresholds as they are for now.** Nothing in this history supports moving to 0.7. Re-run after about 100 current-policy intakes.                                                                                                         | 0 values in 0.7–0.8 for acting Nouls                                                    | –                                                             |
| 11  | Revisit rule "chat model · top tier" for Ask turns (the Opus Ask cost $0.19 vs about $0.03–0.05 on Sonnet; Jev tier said small, and the user switched the chat to Sonnet right after).                                                                 | 1 case                                                                                  | Low                                                           |

## Data gaps and logging to add

- **`runs.requested_mode`** is always null. Log the mode the user picked separately from the mode the harness ran, which is needed to measure "Jev said answer, user wanted build".
- **Human vs scripted source**: add `runs.source` (ui / e2e / bench / digest) so audits and `jev:thresholds` can filter. Today this has to be guessed from 1–2 s approval latencies and fixture paths.
- **cwd / project per run**: only available in `run_protocol_log`, which gets pruned. Add `runs.cwd` and `runs.project_id`.
- **Card default and shown order**: `approvals` stores the chosen option but not which option was the default or pre-selected. Add `default_option_id` and `shown_at` (render time, versus created_at).
- **Follow-up intent**: nothing links "user rephrased or asked to build after an answer-only turn". Add a `mode_switch` signal (answer-only turn followed within N minutes by a Do/build turn in the same chat) and a `clarify_override` signal.
- **Rank ground truth for answer turns**: log files read (tool-call locations) as a secondary label on `run_advice`/`task_outcomes`; `kept.files` covers edits only.
- **Codex cost**: 4 runs have no cost; add an estimate with `cost_source='estimated'`.
- **`vague` / `continues_task` never asked**: log a `not_asked` reason per question in the intake body, so a missing question can be told apart from one not applicable.
- **Effort applied**: record `used_effort='default'` (with reason) when the agent refuses the requested effort.
- `followed_instructions` is never populated; either wire it up or drop it.
