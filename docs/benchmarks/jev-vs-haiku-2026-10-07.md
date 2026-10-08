# Jev against Claude Haiku 5.5 · 2026-10-07

Claude Haiku 5.5 came out today. This measures whether it could answer the questions Spark asks Jev, as a fallback when Jev is not connected or as a replacement. Nothing in the product changed: this is measurement only.

Code: `scripts/jev-versus.ts` and `scripts/jev/versus-*.ts` (`pnpm jev:versus <items|capture|ask|report> --out <dir>`). Raw requests, answers and the full report are kept outside the repository.

## Short answer

- **Answers:** on the 637 labelled questions Haiku 5.5 is as accurate as Jev (91% and 91%). It is better on the verifier's verdict and on "vague", worse on the four-way `need`.
- **Time:** Jev answers in about 0.2 s. Haiku needs 3.4 s for a batched call (the way Spark asks Jev) and 1.4 s for one question, before 2.2 s of process start on the CLI path. 57% of batched Haiku calls took longer than Spark's 3 s line for Jev.
- **Cost:** a call costs about 14 times Jev's ($2.60 against $0.19 per 1,000 calls), and a typical turn about 12 times ($0.006 against $0.0005) without file ranking.
- **Lines:** Haiku's probabilities are as well calibrated as Jev's, but it spreads them more over several options, so at Spark's current lines it acts on 54% of questions where Jev acts on 77%. It needs its own lines.

## Where Spark asks Jev

Fourteen call sites (`callJev` and `askJev`). Tokens are the state only.

| Use | Questions in a call | State tokens | Waits | Calls | Acts at | Without Jev |
| --- | --- | --- | --- | --- | --- | --- |
| Intake | 10–15: `intent`, `need`, 4–7 Nouls, 4 ratings, `tier` | 50–1,200 | 3 s, blocks the turn | 1 per turn | 0.8 (ratings 0.5, tier observed) | rules |
| Builder count and piece questions | 5 per piece, plus `builders` | 1–2K | 3 s, blocks the build | 1 per build | 0.7 count, 0.5 signals | rules |
| Message during a build | 1 Choice of 3 | under 100 | 3 s, in the background | 1 per message | 0.8 | rules |
| Verifier | `verdict` plus up to 5 `unmet` Nouls | 1–4K, up to 8.6K | 3 s, blocks the end of the turn | up to 2 per turn | 0.8 | not verified |
| Critic findings | up to 10 Nouls | 1–4K | 3 s, blocks | 1 per Critic verdict with concerns | 0.8 or 0.2 | finding rules |
| Edit gate | 4 Nouls | 300–1,500 | 3 s, background | 1 per proposed edit | observed only | not asked |
| Shadow route | 1 Choice over models | 100–3,000 | 3 s, background | 2 per Do turn | observed only | not asked |
| File ranking | 1 Choice over up to 255 files | 50–300, options up to 19K | context waits 1.5 s | 1 per Do turn with a scan | orders the files | scan order |
| File previews | up to 16 Nouls | 2–5K | 1.5 s in total | up to 2 per Do turn | observed only | not asked |
| Map area label | 2–3 Choices | 3–6K | 20 s, background | 1 per area, up to 300 | 0.8 | rule labels |
| Map link match | 1 Choice over routes | 100–250 | 20 s, background | up to 40 per repo pair | 0.8 | all links kept |
| Pull request feedback | 1 Choice of 6 per item | about 10 | 3 s, background | 1 per poll with new feedback | 0.6 | rules |
| Chat update | 1–2 Choices | 100–150 | 4 s, blocks the request | 1 per update | 0.6 | rules |

The Map builds fully without Jev: areas get their rule label and every ambiguous link is kept. Titles and the digest do not call Jev. In the live test evidence a turn made 6 Jev calls (median; 2 to 10) with about 12,000 input tokens, $0.0005.

## The set

590 requests with 3,379 questions, each sent unchanged to both models. No chat or audit data from the development database was used.

| Use | Requests | Questions | With ground truth | From |
| --- | --- | --- | --- | --- |
| Intake | 147 | 1,663 | 97 | phrases the rule tests label (`policy.test.ts`, `clarify.test.ts`, `checkpoint-policy.test.ts`), bench task categories, the replay corpus, the live test evidence |
| Verifier | 61 | 244 | 24 | `scripts/verifier` (12 tasks, a correct and a wrong diff each), live evidence |
| Critic findings | 38 | 81 | 24 | the same 24 diffs with the missed requirement as the finding, live evidence |
| Edit gate | 24 | 96 | 0 | the same 24 diffs |
| Message during a build | 9 | 9 | 9 | `mid-build-question.test.ts` |
| Pull request feedback | 12 | 12 | 12 | `triage.test.ts` |
| Shadow route | 61 | 61 | 0 | live evidence |
| Pieces and Builder count | 18 | 301 | 0 | piece lists from the live evidence |
| Map area label | 137 | 411 | 0 | a Map build of this repository (3,976 files, 137 areas) |
| File ranking | 30 | 30 | 30 | a code scan of this repository per commit subject; the truth is the files that commit changed |
| File previews | 53 | 471 | 471 | the same scans; the truth is whether the commit changed the file, a proxy |

The live evidence is the stored requests of Spark's real-provider tests on throwaway repositories. Map link match and chat update were not measured.

## Method

- **Jev:** `jev-1.13.0` through Spark's client (`askSystemOne`), 10 s timeout.
- **Haiku 5.5:** `claude -p --model claude-haiku-5-5` (Claude Code 2.1.282) with the user's Claude sign-in, no tools, no settings, a fixed system prompt, and `--json-schema` asking for a probability per option (Choice), per rubric level (Score) and P(true) (Noul). Probabilities were divided by their sum.
- **Runs:** batched at low effort (all of a request's questions in one call, as Spark asks Jev; every request except 68 Map areas), one question per call at low effort (up to 6 questions of every third request), batched at medium effort (every fourth request), and 8 requests merged into one call (Map labels and file previews).
- **Confidence** is Jev's: `(n·p − 1)/(n − 1)` for the top probability over n options; a Noul line of 0.8 is 0.6 on that scale.
- Thinking cannot be switched off through the CLI for this model (`--thinking disabled` is accepted and it still thinks on multi-question requests). The API allows it; that path was not measured.

## Answers

Questions with ground truth. "Acts" is the share at or above Spark's line; "right" is accuracy among those. Haiku is the batched low-effort run.

| Question | n | Line | Jev accuracy | Jev acts | Jev right when acting | Haiku accuracy | Haiku acts | Haiku right when acting |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intake `need` | 45 | 0.8 | 98% | 61% | 100% (26) | 84% | 20% | 100% (13) |
| Intake `intent` | 14 | 0.5 | 86% | 93% | 86% (14) | 86% | 75% | 92% (13) |
| Intake `destructive` | 20 | 0.8 | 90% | 95% | 100% (14) | 90% | 97% | 100% (16) |
| Intake `vague` | 18 | 0.8 | 50% | 69% | 64% (14) | 83% | 69% | 85% (13) |
| Verifier `verdict` | 24 | 0.8 | 83% | 79% | 90% (21) | 100% | 51% | 100% (20) |
| Critic finding | 24 | 0.8 | 100% | 57% | 100% (21) | 100% | 78% | 100% (24) |
| Message during a build | 9 | 0.8 | 100% | 89% | 100% (8) | 100% | 67% | 100% (6) |
| Pull request feedback | 12 | 0.6 | 100% | 100% | 100% (12) | 100% | 100% | 100% (12) |
| File preview | 471 | 0.8 | 92% | 71% | 97% (336) | 91% | 76% | 97% (356) |
| All labelled | 637 | own | 91% | 77% | 96% (466) | 91% | 54% | 97% (473) |

Without ground truth, the share of questions where Haiku picks what Jev picks:

| Question | n | Same pick | Jev acts | Haiku acts |
| --- | --- | --- | --- | --- |
| Intake ratings (complexity, stakes, context, ambiguity) | 588 | 71%, 60%, 47%, 33%; within one level 93–100% | 59–82% | 3–33% |
| Intake `tier` (observed) | 147 | 66% | 38% | 1% |
| Intake `plan_only`, `review` | 294 | 99% | 95–99% | 99% |
| Piece kind and reliability | 112 | 98%, 100% | 98–100% | 52%, 100% |
| Piece reasoning, coding, context | 168 | 66%, 89%, 84%; within one level 100% | 96–100% | 4%, 20%, 41% |
| Edit gate, four Nouls | 96 | 92–100% | 50–100% | 88–100% |
| Shadow route | 61 | 72% | 51% | 18% |
| Verifier `unmet` | 183 | 93% | | |
| Map category, kind, name | 69 each | 84%, 91%, 77% | 62%, 81%, 62% | 4%, 10%, 0% |

File ranking over 255 candidate files, 30 requests: recall of the changed files in the first 5 is 3% in scan order, 25% in Jev's order and 27% in Haiku's; in the first 12 it is 7%, 26% and 29%.

### Calibration

Stated probability of the picked answer against how often it was right, labelled questions:

| Stated | Jev n | Jev right | Haiku n | Haiku right |
| --- | --- | --- | --- | --- |
| 0.5–0.6 | 47 | 57% | 23 | 43% |
| 0.6–0.7 | 31 | 77% | 57 | 68% |
| 0.7–0.8 | 88 | 86% | 68 | 82% |
| 0.8–0.9 | 175 | 93% | 134 | 91% |
| 0.9–1.0 | 293 | 98% | 351 | 99% |

Brier score 0.076 for Jev and 0.070 for Haiku; expected calibration error 0.064 and 0.067. Haiku's numbers mean what they say. It acts less at Spark's lines because it gives the top option of a Choice or a rubric less of the mass than Jev does. The lowest line at which Haiku is right as often as Jev is at Spark's line: `need` 0.7 (it then acts on 35%, Jev on 61%); `vague`, `destructive`, `intent`, verdict, finding and the build message all hold at 0.2. These come from 9 to 45 labelled items each and are a starting point, not tuned lines.

### Effort and call shape

| Run | Labelled | Accuracy | Acts | Right when acting | `need` accuracy | Verdict accuracy |
| --- | --- | --- | --- | --- | --- | --- |
| Batched, low | 637 | 91% | 54% | 97% | 84% (45) | 100% (24) |
| One question per call, low | 90 | 89% | 62% | 95% | 93% (15) | 100% (8) |
| Batched, medium | 43 | 88% | 50% | 94% | 83% (12) | 100% (6) |
| 8 requests merged, low | 180 | 88% | 45% | 97% | | |

Medium effort was slower and no more accurate. Merging 8 requests into one call lowered accuracy on file previews (88% against 91%).

## Time and cost

Per call. "API" is the time the CLI reports for the model request; "wall" adds starting the CLI.

| Use | Jev ms p50 / p95 | Haiku batched API ms p50 / p95 | Over 3 s | Haiku one question API ms p50 / p95 | Jev USD per 1,000 | Haiku batched USD per 1,000 |
| --- | --- | --- | --- | --- | --- | --- |
| Intake | 203 / 305 | 4,383 / 6,850 | 86% | 1,309 / 2,367 | 0.10 | 1.23 |
| Pieces | 206 / 394 | 4,509 / 9,493 | 100% | 1,402 / 2,449 | 0.20 | 2.49 |
| Message during a build | 190 / 269 | 1,187 / 1,707 | 0% | 1,221 / 1,764 | 0.02 | 0.31 |
| Verifier | 194 / 385 | 2,502 / 9,152 | 43% | 1,511 / 3,680 | 0.09 | 1.03 |
| Critic findings | 190 / 520 | 1,490 / 4,964 | 26% | 1,758 / 3,047 | 0.09 | 0.93 |
| Edit gate | 190 / 304 | 2,091 / 2,572 | 4% | 1,105 / 1,545 | 0.04 | 0.53 |
| Shadow route | 193 / 289 | 2,002 / 3,609 | 13% | 2,055 / 3,213 | 0.09 | 0.81 |
| File ranking | 303 / 494 | 26,987 / 59,204 | 100% | | 0.82 | 22.16 |
| File previews | 199 / 391 | 3,560 / 5,974 | 57% | 1,516 / 2,607 | 0.21 | 1.88 |
| Map area label | 231 / 313 | 3,284 / 4,073 | 68% | 1,633 / 3,084 | 0.31 | 2.86 |
| Pull request feedback | 186 / 235 | 1,165 / 1,457 | 0% | 993 / 1,025 | 0.02 | 0.31 |
| All | 206 / 332 | 3,365 / 20,438 | 57% | 1,447 / 2,859 | 0.19 | 2.60 |

- **Process start.** Wall time minus API time was 2.2 s at the median (4.4 s at p95, with three calls running at once). A long-lived session would save that; it was not measured directly.
- **Batching costs time.** A multi-question request makes Haiku think first (about 1,100 thinking tokens on intake), which is most of the 4.4 s. One question per call rarely thinks.
- **A turn.** Six calls: $0.0005 with Jev, about $0.006 with Haiku batched, and $0.03 if file ranking is included. Intake as 11 separate questions costs $0.0036 where the batch costs $0.0012.
- **A Map build of this repository.** 137 areas, 1.01M input tokens: $0.042 with Jev, 137 calls of 0.23 s. With Haiku $0.39 one area per call (3.3 s each). Each area's state is capped at about 7,000 tokens, so Jev's 64K input limit forces no chunking here and Haiku's larger window brings nothing: 8 areas in one call is over 100,000 tokens on Haiku's tokenizer, which moves the call to the higher price ($1.69 for the build) and took 6.9 s per call with 17% over 10 s.
- **Failures.** None of 1,307 Haiku calls failed, timed out at 120 s, refused or returned unreadable output (the schema is enforced). 48 of 2,525 Choice and Score answers summed more than 0.05 away from 1. 6% of batched calls passed 10 s, all 30 file-ranking calls among them. Jev failed none of 590.

## Verdict by use

| Use | Verdict | Deciding numbers |
| --- | --- | --- |
| Intake | Keep Jev. As a fallback only as separate questions with its own lines | `need` 84% against 98%; batched 4.4 s against 0.2 s in front of every turn; one question 1.3 s; ratings act on 3–33% at today's line |
| Pieces and Builder count | Keep Jev; rules without it | 4.5 s (p95 9.5 s) before a build starts; scores within one level but 4–41% act; no ground truth |
| Message during a build | Haiku is as good | 9 of 9 both; 1.2 s in the background |
| Verifier | Haiku is better, slower | 24 of 24 against 20 of 24; right when acting 100% against 90%; 2.5 s, p95 9.2 s, at the end of a turn |
| Critic findings | Haiku is as good | 24 of 24 both; acts on 78% against 57%; 1.5 s |
| Edit gate | As good by agreement; observed only | 92–100% same answer; no ground truth |
| Shadow route | Keep Jev; observed only | 72% same pick; no ground truth |
| File ranking | Haiku is not usable | same recall (27% and 25%) at 27 s and $0.022 a call; the context waits 1.5 s |
| File previews | Haiku is not usable in time | 91% against 92%; 3.6 s against a 1.5 s deadline |
| Map area label | Usable as a fallback with its own lines; unproven | 77–91% same label; acts on 0–10% at 0.8; $0.39 against $0.04 a build; background, so time is fine |
| Pull request feedback | Haiku is as good | 12 of 12 both; 1.2 s in the background |
| Map link match, chat update | Not measured | |

## Recommendation

1. **Jev not connected.** Haiku 5.5 could replace the rules for the verifier, Critic findings, the message during a build and pull request feedback: each is one small call that is off the turn's critical path or at its end, and Haiku matched or beat Jev there. Map labels could follow after a labelled check. Intake should stay on rules unless it is asked as separate parallel questions inside a budget of about 2.5 s, with lines tuned for Haiku.
2. **Haiku instead of Jev everywhere.** No. It is 7 to 16 times slower and about 14 times the cost for the same accuracy, it cannot do file ranking or previews in their time limits, and every line would need re-tuning.
3. **A mix.** Jev stays first wherever it is connected. The one place Haiku measured better is the verifier's verdict, on 24 cases; that is worth a larger labelled run before anything changes.

A product integration would need: an advisor seat that runs on the chat's own Claude sign-in (a long-lived session, since starting the CLI costs 2.2 s a call) or an API key with thinking off; a time budget per use; lines tuned for Haiku on labelled data; the same data-sent rules as Jev, because the same task text and diffs would go to Anthropic; and a decision for chats with only Codex connected, which have no Claude sign-in and would stay on rules unless a small Codex model is measured the same way.

## Limits

- Ground truth covers 637 of 3,379 questions, and most labelled sets are small (9 to 45). The intake labels come from phrases written to test the rules, and the finding set has one synthetic finding per diff.
- Map labels, pieces, ratings, the edit gate and the shadow route have no ground truth: agreement with Jev is not accuracy.
- Haiku ran through the Claude Code CLI. Direct API latency, thinking off, and a long-lived session were not measured.
- Three Haiku calls ran at once on a machine running other tests, so wall times are high; API times are the model's own.
- The CLI does not know this model's price and reports cost at Opus 5.5 rates. Costs here use the published Haiku 5.5 prices, with cache writes at the 1-hour rate the CLI used.
- One run. Jev's answers move by about 0.01 between runs; Haiku's variance was not measured.
