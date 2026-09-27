# Lean harness rerun · 2026-09-27 (round 10)

A live rerun of the round-5 scenarios to test whether the lean harness (checkpoint `104bcbe`) closes the cost gap without losing quality. Lean means one Builder, rules-only routing, checks with up to 2 fix turns, a Critic only for destructive work, review requests or large diffs, Jev only for question, vague and review intent, and the policy gate and verifier in observation mode. It is compared with:

- the full harness at `d87e633` (Architect, lanes, work orders, plan session, watchdog, Jev transitions);
- direct Claude;
- direct Claude with the project's checks and up to 2 fix turns.

Round 5: [harness-e2e-live-2026-09-26.md](harness-e2e-live-2026-09-26.md). Data: [harness-e2e-lean-2026-09-27.json](harness-e2e-lean-2026-09-27.json).

**Spend:** $9.53 API-equivalent of the $10 cap, over 82 cells. That includes option A, the second lean repeat, run because spend after the main pass was $7.78. Jev cost $0.02.

## Headline

1. **The lean harness closed most of the gap.** On the 18 scenarios shared with the direct arms:

   | Arm | Pass | Cost | Wall | Cost ÷ direct Claude |
   | --- | --- | --- | --- | --- |
   | Lean 104bcbe (n=2) | 18/18 (36/36 runs) | $1.72 | 13.3 min | 1.58× |
   | Direct Claude + checks (n=1) | 17/18 | $1.77 | 12.6 min | 1.62× |
   | Direct Claude (round 5, n=2) | 16/18 | $1.09 | 6.4 min | 1.00× |
   | Full d87e633 (n=1) | 18/18 | $3.20 | 20.3 min | 2.94× |
   | Full d4c59d3 (round 5, n=2) | 16.5/18 | $2.43 | 15.2 min | 2.23× |

   - Lean is 46% cheaper and 35% faster than the full harness at d87e633, with the same pass rate.
   - Against round 5's harness it is 29% cheaper and passes more (it fixed round 5's d #1 and n failures).
   - Lean costs 1.58× bare direct Claude and 0.97× direct Claude with checks. Almost all of the gap left is the checks and fix turns every serious arm pays for, plus Balanced approvals (5.4 per run).
2. **Checks are the decisive cheap test.** Direct Claude alone fails g 0/2 (the project lint it doesn't know about). With the checks and one fix turn it passes for $0.076. The lean Builder passed g without a failed check: it updated `api-surface.json` itself.
3. **The fixed bugs, checked live on lean:**

   | Bug | Result |
   | --- | --- |
   | Ambiguous request asks first (n) | Fixed, 2/2 |
   | Turn 2 resumes (i) | Fixed, 2/2: "Continued session", $0.026 against $0.045–0.050 in round 5 |
   | Codex Builder usage counted (reversed j) | Fixed: 476k input, 5.6k output, $0.236; passed, no false budget stop |
   | Half-built plan reported done (round 5 d #1) | Gone with the Architect; d passed 2/2 with one Builder |

4. **Still broken:**
   - **Review requests get no Critic in lean** (e 0/2, and j 0/2 "have a reviewer check"). Only destructive f and the large-diff rename q got a Critic.
   - **The lean loop guard stops good runs.** "Bolt repeated `Read File` 5 times in a row" ended s #2 before the user's Stop, and ended the GLM c run with no edits. It appears to key on the tool title, not the file.
   - **A cancelled run records $0 cost** (s, both runs).
5. **Observation mode tells us little yet.**
   - The verifier said "pass" on all 42 lean runs it saw; all 42 passed. It never saw a failing run: it didn't run on the two failures (the s #2 guard stop and GLM c).
   - The policy gate said "allow" 161 times and "review" 4 times, all on runs that passed. That is 4 false alarms and no true positives, because nothing failed.
   - Neither can be scored for recall until a run fails after an edit.

## Per scenario

Pass · mean cost · mean wall. The lean-to-direct ratio is against round 5's direct Claude (n=2).

| Scenario | Lean 104bcbe (n=2) | Full d87e633 | Direct + checks | Direct Claude (r5) | Full d4c59d3 (r5) | Lean ÷ direct |
| --- | --- | --- | --- | --- | --- | --- |
| a · question | 2/2 · $0.021 · 12 s | 1/1 · $0.021 · 11 s | 1/1 · $0.040 · 8 s | 2/2 · $0.021 · 7 s | 2/2 · $0.028 · 12 s | 1.00× |
| b · single-file fix | 2/2 · $0.043 · 17 s | 1/1 · $0.033 · 20 s | 1/1 · $0.036 · 22 s | 2/2 · $0.045 · 14 s | 2/2 · $0.029 · 22 s | 0.96× |
| c · vague multi-module | 2/2 · $0.170 · 83 s | 1/1 · $0.509 · 88 s | 1/1 · $0.242 · 91 s | 2/2 · $0.115 · 43 s | 2/2 · $0.361 · 100 s | 1.48× |
| d · two features | 2/2 · $0.140 · 65 s | 1/1 · $0.362 · 139 s | 1/1 · $0.152 · 49 s | 2/2 · $0.103 · 31 s | 1/2 · $0.216 · 68 s | 1.35× |
| e · review request | 2/2 · $0.099 · 54 s | 1/1 · $0.189 · 97 s | 1/1 · $0.107 · 57 s | 2/2 · $0.085 · 40 s | 2/2 · $0.108 · 51 s | 1.17× |
| f · destructive | 2/2 · $0.194 · 66 s | 1/1 · $0.271 · 121 s | 1/1 · $0.096 · 39 s | 2/2 · $0.085 · 28 s | 2/2 · $0.263 · 91 s | 2.27× |
| g · unknown project check | 2/2 · $0.072 · 32 s | 1/1 · $0.079 · 32 s | 1/1 · $0.076 · 32 s | **0/2** · $0.035 · 12 s | 2/2 · $0.115 · 35 s | 2.05× |
| h · cache (L2) | 2/2 · $0.066 · 35 s | 1/1 · $0.080 · 43 s | 1/1 · $0.081 · 31 s | 2/2 · $0.063 · 23 s | 2/2 · $0.059 · 38 s | 1.04× |
| i · two turns | 2/2 · $0.077 · 37 s | 1/1 · $0.058 · 44 s | 1/1 · $0.073 · 31 s | 2/2 · $0.070 · 25 s | 2/2 · $0.083 · 47 s | 1.10× |
| j · build and review | 2/2 · $0.131 · 71 s | 1/1 · $0.362 · 193 s | – | – | 2/2 · $0.349 · 248 s | – |
| k · Python | 2/2 · $0.066 · 35 s | 1/1 · $0.066 · 47 s | 1/1 · $0.060 · 91 s | 2/2 · $0.046 · 16 s | 2/2 · $0.056 · 25 s | 1.44× |
| l · type errors | 2/2 · $0.077 · 37 s | 1/1 · $0.368 · 59 s | 1/1 · $0.074 · 34 s | 2/2 · $0.040 · 12 s | 2/2 · $0.174 · 59 s | 1.94× |
| m · accessible toggle | 2/2 · $0.057 · 25 s | 1/1 · $0.068 · 45 s | 1/1 · $0.037 · 14 s | 2/2 · $0.036 · 12 s | 2/2 · $0.037 · 22 s | 1.60× |
| n · ambiguous | **2/2** · $0.073 · 47 s | 1/1 · $0.215 · 96 s | 0/1 · $0.165 · 57 s | 0/2 · $0.058 · 20 s | 0/2 · $0.234 · 61 s | 1.24× |
| o · upload guard | 2/2 · $0.057 · 26 s | 1/1 · $0.039 · 26 s | 1/1 · $0.054 · 26 s | 2/2 · $0.047 · 16 s | 2/2 · $0.045 · 31 s | 1.22× |
| p · docs only | 2/2 · $0.043 · 18 s | 1/1 · $0.037 · 17 s | 1/1 · $0.036 · 13 s | 2/2 · $0.035 · 13 s | 2/2 · $0.041 · 21 s | 1.23× |
| q · 13-file rename | 2/2 · $0.202 · 86 s | 1/1 · $0.098 · 41 s | 1/1 · $0.169 · 64 s | 2/2 · $0.051 · 17 s | 2/2 · $0.207 · 78 s | 3.95× |
| r · turn 2 changes the plan | 2/2 · $0.118 · 61 s | 1/1 · $0.257 · 97 s | 1/1 · $0.108 · 37 s | 2/2 · $0.085 · 31 s | 2/2 · $0.210 · 103 s | 1.39× |
| s · Stop mid-run | 1/2 · $0.000 · 21 s | – | – | – | 2/2 · $0.084 · 54 s | – |
| t · lanes in one file | 2/2 · $0.142 · 63 s | 1/1 · $0.450 · 194 s | 1/1 · $0.165 · 62 s | 2/2 · $0.070 · 23 s | 2/2 · $0.161 · 48 s | 2.03× |

**Drift checks.** Fresh direct Claude runs cost $0.120 on c (round 5: $0.115) and $0.100 on q (round 5: $0.051), both passing. Direct cost on q has doubled since round 5, so the q ratio above overstates the lean gap. Against today's direct cost, lean on q is about 2.0×.

**Diffs.** Lean diffs are the same size as direct or smaller:
- c: +20 against +28 for direct with checks;
- h: +36 against +62 (Lean build style on by default);
- n: +14 against +44.

The full harness at d87e633 wrote more on c, e, h and j.

## Where the money still goes

- **Planned-looking work at execute depth** (c, d, l, r, t) now costs 1.35–2.0× direct, against 2.1–4.4× in round 5.
- **Destructive f** costs 2.27× direct, because the rule picks the top tier (Opus Builder, $0.19) and adds a Codex Critic. Jev said Sonnet at 0.98. Round 5's rules-only runs on f passed with Sonnet for $0.05–0.08.
- **q (the rename)** costs 2–4× direct. The Builder does it in 86 s with 5 file reads, and the diff is large enough to trigger a Critic.
- **Approvals at Balanced:** 216 answers over 40 UI runs (135 commands, 41 edits, 40 Keep). This mostly costs wall time. The direct arms run at Full auto.

## Rule route vs Jev's tier pick

Lean routes with rules only. Jev's tier pick is recorded as `autoWouldUse`.

| Scenario | Rule fired | Rule pick | Jev tier (confidence) | Jev pick | Outcome | Cost | Who was right |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | chat model | Sonnet (Scout) | small (0.97) | Haiku | pass 2/2 | $0.021 | Jev likely: a read-only answer |
| b | chat model | Sonnet | small (0.99) | Haiku | pass 2/2 | $0.043 | **Jev**: Haiku passed b in round 5 for $0.029 |
| c | chat model | Sonnet | mid (0.42) | Sonnet | pass 2/2 | $0.170 | agree (Haiku failed c in round 5) |
| d | chat model | Sonnet | mid (0.98) | Sonnet | pass 2/2 | $0.140 | agree |
| e | chat model | Sonnet | mid (0.91) | Sonnet | pass 2/2 | $0.099 | agree (Haiku failed e in round 5) |
| f | destructive → top tier | Opus | mid (0.98) | Sonnet | pass 2/2 | $0.194 | **Jev**: Sonnet passed f for $0.05–0.08 in round 5 |
| g | chat model | Sonnet | small (0.64) | Haiku | pass 2/2 | $0.072 | **Jev**: Haiku passed g in round 5 ($0.066) |
| h | chat model | Sonnet | mid (0.87) | Sonnet | pass | $0.066 | agree |
| i | chat model | Sonnet | small (0.83–0.86) | Haiku | pass 2/2 | $0.077 | **Jev**: Haiku did turn 1 in round 5 and passed |
| j | chat model | Sonnet | mid (0.93) | Sonnet | pass | $0.131 | agree |
| k | chat model | Sonnet | small (0.63) | Haiku | pass | $0.066 | untested with Haiku |
| l | chat model | Sonnet | mid (0.71) | Sonnet | pass | $0.077 | agree |
| m | chat model | Sonnet | small (0.81) | Haiku | pass | $0.057 | untested with Haiku |
| n | chat model | Sonnet | mid (0.37) | Sonnet | pass | $0.073 | agree |
| o | chat model | Sonnet | small (0.52) | Haiku | pass | $0.057 | **Jev**: Haiku passed o in round 5 ($0.033) |
| p | chat model | Sonnet | small (0.65) | Haiku | pass | $0.043 | untested with Haiku |
| q | chat model | Sonnet | mid (0.93) | Sonnet | pass | $0.202 | agree |
| r, s, t | chat model | Sonnet | mid (0.73–0.99) | Sonnet | pass | – | agree |
| j, Codex chat | chat model | 6 Sol | small (0.05) | 6 Luna | pass | $0.236 | untested; Jev was unsure |
| g, GLM chat | chat model | GLM-5.3 | small (0.99) | GLM-5.3-Flash | pass | $0.030 | untested |
| c, GLM chat | chat model | GLM-5.3 | top (0.05) | GLM-5.3 | loop-guard stop | $0.009 | – |

**On the keyword rules.**
- The "trivial → small tier" rule never fired in 42 lean runs, not even on the one-line fix (b), the docs change (p) or the question (a). The brief 13-file rename (q) was routed "chat model", not "trivial", so the misclassification the user was worried about did not happen here.
- The rules and Jev disagreed on 10 scenario types (the table plus a, i, k, m, p). Where round 5 has Haiku evidence (b, g, i turn 1, o), Jev's small tier was right both on quality and cost. Where Jev said mid (c, e), Haiku had failed in round 5, so Jev was right again.
- On f, the destructive rule's top tier cost 2.5–4× what Jev's Sonnet pick cost in round 5.
- Jev's tier, gated at 0.8 or above, would have picked Haiku on a, b, i and m and Sonnet on f. That is about $0.25 saved per pass on these scenarios, with no known quality loss.

## Observation mode against the hidden checks

| Record | Lean runs | Verdicts | Hidden-check outcome |
| --- | --- | --- | --- |
| `verify` (diff verifier, policy lean-1) | 42 | 42 "would pass" (l and m noted "1 unmet requirement" but still passed them) | 42 passed; accuracy 42/42, but no failing run was verified |
| `policy` (edit gate, lean-1) | 165 edits | 161 allow, 4 review (all on c), 0 block | all on passing runs; 4 false "review", 0 true positives |

- The verifier did not run on the two failed lean runs (the guard stops in s #2 and GLM c) or on the question cells (a).
- To measure recall, the next round needs a task designed to fail after an edit, such as a Haiku-pinned c or e.

## Findings that matter

1. **Review requests get no Critic in lean** (e and j, 0/4). This regression is still open from rounds 3–5. Only destructive work and large diffs (q) triggered one. Review intent should always add a Critic.
2. **The loop guard is a false positive.** It stopped two good runs on "repeated `Read File`": s #2 before Stop, and GLM c with no edits. The "stuck" card was auto-denied. Key it on the tool and its target, and raise the threshold for reads.
3. **Cancelled runs record $0** (s: the Builder ran 9–21 s). Stopped work is invisible in cost totals.
4. **The destructive top-tier rule is over-provisioned.** A Sonnet Builder with the Critic kept is enough (round 5 and Jev agree).
5. **Let Jev's tier pick act at 0.8 or above for small tasks.** It was right every time it could be checked.
6. **File reads.** The full harness's Architect reads 2–9 files, and its Builders then read 0 (work orders pass the context). The lean Builder reads 0–5. No rereads were recorded anywhere, so double reading is not the cost driver. Architect output (2.8k–8.3k tokens) and a second agent are.
7. **Direct Claude with checks** is a strong, cheap baseline: 17/18, and it fixed g in one fix turn. Lean matches its cost and adds the clarify question on n (+1 pass), resume on i, and the approvals and audit trail.

## Recommendations (ranked)

1. Add a Critic for review intent: review requests currently get none in lean.
2. Fix the loop guard's false positives (key on the target; more room for reads).
3. Let Jev's tier act at 0.8 or above for the small tier, and use Sonnet rather than the top tier for destructive work with the Critic kept.
4. Record the cost of cancelled runs.
5. Keep checks with 2 fix turns as the core of lean. It is the one mechanism that changed an outcome (g).
6. Give the verifier and policy gate a failing-task set before trusting them: 42/42 and 161/165 are all true negatives.
7. Remove the dead "trivial → small tier" rule, or feed it Jev's tier: it never fired.

## Method

- **Lean arm.** A worktree at `104bcbe`, its own schema and ports. The UI was driven with Playwright at Balanced, Auto, Do and Lean (the default); s was stopped from the UI.
- **Full arm.** A worktree at `d87e633`, its own database and ports, driven through the HTTP API at Balanced (as the round-5 versions block was). s was dropped from this arm: an API cancel on d87e633 hung in the dry run.
- **Direct Claude plus checks.** The bench direct arm (Sonnet medium, Full auto). After each turn the app's own `detectChecks` commands run (the configured unittest command for k). Failures go back in the same session, up to 2 fix turns. The direct arm now records its reply, so follow-ups resume the session.
- **Direct Claude (round 5).** Reused: those fixtures are unchanged since `3fb0e69`. The drift cells on c and q show direct costs have not fallen.
- **Fixtures.**
  - The e2e-lanes fixture had been lost from the working tree; it was restored from `ab1bbc6` (t crashed once before the restore, and nothing was lost).
  - The q1 rename check also failed a README sentence where the deprecation note wraps onto the next line. It was fixed, and all q cells were rescored (they pass).
- **Sample size.** n=1 or 2. Treat single-run differences, and ratios within about 1.3×, as noise.
