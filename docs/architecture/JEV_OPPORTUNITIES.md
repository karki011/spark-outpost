# Jev opportunities

Written on September 27, 2026, after re-reading the TypeSafe docs in full (see [JEV.md](JEV.md#docs-review-2026-09-27)). This file ranks the places where Spark Outpost should ask Jev more often, and flags the places where Jev is the wrong tool. Nothing here is built yet.

## Why more Jev

- **Cost.** One Jev call is $0.042 per million input tokens, and output is free. A 2,500-token batch costs about $0.0001.
  - The live e2e run made 364 Jev calls for $0.018 in total (benchmarks/harness-e2e-live-2026-09-26.md).
  - A routine "what next?" turn for a Lead LLM (10k tokens in, 300 out) costs about $0.012 on Haiku 4.5 and $0.023 on Sonnet 5. That is roughly 100 to 200 times more, and it takes 3 to 10 s instead of 0.15 to 0.5 s.
- **Shape.** Jev returns a typed answer with probabilities, so the orchestrator's code can branch on it directly. An LLM turn would need parsing and would still be uncalibrated.
- **The limit.** Jev only judges and picks. It never writes a plan, a summary, a fix instruction or code (https://docs.typesafe.ai/model-jaggedness/jev-1.13#generation). Every opportunity below keeps generation with an LLM and gives Jev only the narrow decisions around it.

## Rules for every new use

These follow the docs and our existing authority rules in [HARNESS_PLAN.md](HARNESS_PLAN.md#jev-can-never-grant-permissions).

1. **Code owns the flow.** Jev answers atomic questions, and a pure function turns the answers into the decision. A question that reads like "what should we do?" is split into facts (https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
2. **One call per event.** Every question on the same state goes into one batch, speculative ones included (https://docs.typesafe.ai/patterns/fan-out).
3. **Noul criteria use `true` and `false`**, and a high value means the thing we check for. Where a list of checks guards against a bad result, frame each check as bad = true and act on the `max` (https://docs.typesafe.ai/cookbooks/sde_cascade).
4. **No arithmetic for Jev.** Counts, times, token budgets and prices stay in code. Jev gets named buckets such as "checks failed" or "no retries left".
5. **Gate every answer.** Use a noul band per action, or the top probability or margin for a Choice (see [JEV.md](JEV.md#where-our-code-goes-against-the-docs), point 3). Below the band the existing rules decide.
6. **Jev never grants anything.** It never answers an approval, loosens a mode, extends a budget, skips a safety check, or marks work verified. It can make the harness do more (continue, review, ask), and less only where a rule already allows it.
7. **Shadow first.** Each new decision first records Jev's answer next to the rule's as a `run_advice` row with its own `purpose`, as S2 did. It acts only after the Harness tab's "who was right" comparison supports it: at least 3 turns on each side and a gap of 0.2 or more, or 30 labelled cases.
8. **Store `response.model`** on every row, so a change of Jev version shows up in the analytics.

## Ranked opportunities

| #   | Opportunity                         | Replaces or improves                                        | Extra calls                         | Cost per call | Fit      |
| --- | ----------------------------------- | ----------------------------------------------------------- | ----------------------------------- | ------------- | -------- |
| 1   | Did the Builder do its steps?       | "anything not ticked is completed", the broad `status`      | 0 (joins the transition batch)      | ~$0.0001      | Strong   |
| 2   | Lead decisions as atomic facts      | `next` and `quality`, the transition rules, a Lead LLM turn | 0 (replaces the transition call)    | ~$0.00013     | Strong   |
| 3   | Correction follow-ups in the intake | intent `bug_fix` after a change, the phrase list            | 0 (joins the intake batch)          | +$0.00002     | Strong   |
| 4   | Is a Critic needed for this diff?   | depth decided at intake, before any diff exists             | 0 (joins the last transition batch) | ~$0.0001      | Good     |
| 5   | Stuck or looping agent              | only the 60-tool-call and 15-minute budgets                 | 1 per 10 tool calls of a live agent | ~$0.00006     | Good     |
| 6   | Does the plan cover the request?    | nothing: plan approval is manual or skipped                 | 0 (joins the Architect route call)  | ~$0.00013     | Good     |
| 7   | Routing a message sent during a run | every message queues as the next turn                       | 1 per mid-run message               | ~$0.00006     | Good     |
| 8   | Scoping a work order to files       | the files the step names, and the Builder's own search      | 1 per step, or per plan             | ~$0.0004      | Medium   |
| 9   | What to keep when compacting        | compaction is not built (M6)                                | 1 per compaction                    | ~$0.00017     | Medium   |
| 10  | Which checks are relevant           | every configured check after every Builder                  | 0 (joins the transition batch)      | ~$0.00003     | Medium   |
| 11  | Digest and companion priority       | the `endsWithOffer` regex, and a fixed state order          | 1 per digest                        | ~$0.00025     | Medium   |
| 12  | Anomaly flags in analytics          | —                                                           | —                                   | —             | **Poor** |

Top five, by value for the effort: 1, 2, 3, 4 and 5.

---

### 1. Did the Builder do its steps?

**Decision.** When a Builder ends, the flow must decide whether each of its steps is done, and whether the work meets what the step promised. Today:

- A carrying Builder's step markers decide.
- Anything not ticked by a Builder "judged done" is marked complete.
- The transition asks one broad `status` Choice.

The live run finished a half-done plan with "done · next finish" at 0.60 (e2e d #1). Round 5 patched the marker logic. It still cannot catch a Builder that ticks a step it did not really do, or one that stops without saying so.

**Contract.** Ask the Architect to end each step with a `Done when:` line (one to three short checkable facts), next to its `Files:` line. Without it, the step text is the contract.

**Questions**, one batch per finished Builder (step and criterion keys are built in code):

- `step_done_<N>`, one Noul per step the Builder carried:
  ```json
  {
    "type": "noul",
    "instructions": {
      "step": "<steps.N text>",
      "question": "Does `reply` say that `step` was completed?"
    },
    "criteria": {
      "true": "The reply says this step was done, or describes doing it",
      "false": "The reply does not mention this step, says it was skipped, left for later, or failed"
    }
  }
  ```
- `step_left_<N>`, one Noul per step, framed bad = true: "Does `reply` say that `step` was not finished, was skipped, or is left for later?"
- `criterion_unmet_<N>_<i>`, one Noul per `Done when` fact, framed bad = true:
  ```json
  {
    "type": "noul",
    "instructions": {
      "criterion": "<Done when fact>",
      "question": "Do `reply` and `changed` show that `criterion` is NOT met?"
    },
    "criteria": {
      "true": "The reply or the changed files show the criterion is missing, broken or only partly done",
      "false": "The reply and changed files are consistent with the criterion being met"
    }
  }
  ```
- `claims_unverified`, a Noul: "Does `reply` claim tests or checks pass without having run them?"

**State.** `{ steps: {N: text}, reply: <last 1,000 chars, paths redacted>, changed: <changed file names, or a count bucket>, checks: "passed" | "failed" | "not run" }`.

**Gate.**

- A step is done when `step_done` ≥ 0.8, `step_left` ≤ 0.2 and every `criterion_unmet` ≤ 0.3.
- A step is open when `step_left` ≥ 0.7 or any `criterion_unmet` ≥ 0.7.
- Anything in between goes to the rules (markers). A failed check always wins over Jev.
- An open step continues the same Builder (the round 5 `continue` path).

**Fallback.** Today's markers and `firstOpenStep`.

**Cost.** Six steps with two criteria each is about 20 questions plus a 1,500-token state, about 2,500 tokens, or $0.0001. It needs no extra round trip because it joins the transition batch (opportunity 2).

**Measure.**

- In shadow: how often Jev marks a ticked step open, and how often that step's work was really missing (check against the Critic's findings, later corrections and reverts).
- Once it acts: the "Incomplete: steps … are still open" rate, corrections within 24 h, and extra Builder turns and their cost.
- A labelled set from the benchmark runs: at least 30 finished Builders with the truth marked by hand.

---

### 2. Lead decisions as atomic facts

This is the Polly-style Lead. The Lead stays code: the orchestrator's state machine. It makes routine decisions from Jev facts instead of from an LLM turn or one broad Choice.

**Why.** Today one transition call asks `status` (4 options), `quality` (a 5-level Score of degrees) and `next` (2 to 4 options, which is "what should happen next?"). The docs call that a bad question. The varying option count also moves the confidence scale (see [JEV.md](JEV.md#where-our-code-goes-against-the-docs), points 3 and 4). An LLM Lead would cost about $0.01 to $0.02 and 3 to 10 s per decision, and would still be uncalibrated.

**Architecture.**

- Each event gets one Jev batch: an agent finished, failed, asked something, or checks came back.
- Pure `leadDecision(facts, state)` maps the answers to an action.
- When no rule fires and Jev is unsure, today's rules decide.
- A small LLM Lead turn (Haiku, text only) is kept only for generated output: a re-plan, or a fix instruction written for the next Builder.
- The human is asked only where the involvement level already says so.

**The facts.** One batch after each agent finishes, all Nouls unless noted. The state is `{ task, role, step, outcome, reply tail (redacted), verdict, checks, buckets }`. Buckets are named strings from code, such as `"retries": "none left"`.

| Key                 | Instructions                                                                                                                 | Used for                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `reports_error`     | "Does `reply` report an error, a failed command or a crash?"                                                                 | retry vs next                      |
| `env_problem`       | "Does `reply` blame something outside the code, such as a missing tool, network, permission or credential?"                  | escalate to the human, not a retry |
| `needs_user`        | "Does `reply` ask the user a question or say it needs the user to decide something?"                                         | ask the human                      |
| `plan_wrong`        | "Does `reply` say the plan or `step` is wrong, impossible as written, or based on a wrong assumption?"                       | re-plan (the Architect again)      |
| `out_of_scope`      | "Does `reply` describe changing things `step` did not ask for?"                                                              | Critic, and note for the keep card |
| `gave_up`           | "Does `reply` say the agent stopped before finishing?"                                                                       | continue or retry                  |
| `stronger_needed`   | "Does `reply` show the agent misunderstood the code or went in circles, rather than hitting an outside problem?"             | retry one tier up vs the same tier |
| `failure_kind`      | Choice: `code_mistake`, `environment`, `missing_information`, `flaky_tool`, `none`, each described with `what` and `not_for` | picks the retry path               |
| plus opportunity 1  | `step_done_N`, `step_left_N`, `criterion_unmet_…`                                                                            | continue, next step, finish        |
| plus opportunity 4  | the Critic facts, after the last Builder                                                                                     | review or not                      |
| plus opportunity 10 | the check facts, when checks are about to run                                                                                | which checks                       |

**Routine decisions and their rule in code.**

| Decision              | Rule (first match)                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask the human         | `needs_user` ≥ 0.8, or `env_problem` ≥ 0.8. Otherwise the involvement table.                                                                                                                                                                      |
| Re-plan               | `plan_wrong` ≥ 0.85 and the step is not the last one. This asks at Hands-on and Balanced, and re-runs the Architect with the reply as a note at Hands-off and Full auto. Once per orchestration.                                                  |
| Retry vs escalate     | For a failed or `gave_up` result with retries left: `stronger_needed` ≥ 0.7 or `failure_kind` = code_mistake (top probability ≥ 0.7) goes one tier up; `flaky_tool` goes to the same tier; `environment` or `missing_information` asks the human. |
| Result looks complete | Opportunity 1's gate.                                                                                                                                                                                                                             |
| Next action           | Code picks from the plan state: the next open step, the Critic (opportunity 4) or finish. Jev no longer picks `next` directly.                                                                                                                    |
| Which worker          | Code picks the role from the plan (Scout for `Research:` steps, a Builder otherwise). The model routing stays as today. A follow-up after a Critic's concerns goes to the same Builder's `resumeKey`.                                             |

**Gate and fallback.** Every threshold above is a band; below it the current `ruleTransition` decides. `needs_user` and `env_problem` may only add a checkpoint, never remove one.

**Cost.** One call per agent finish, 2,500 to 3,500 tokens, about $0.00013. It replaces today's transition call, so the round trip count is unchanged.

**Measure.**

- Retries that pass against retries that fail, split by `failure_kind`.
- Checkpoints raised per turn, and how often the user picked the option Jev's facts pointed at.
- Re-plans and their outcome scores.
- Lead LLM calls avoided.
- The analytics "who was right" table for each rule.

---

### 3. Correction follow-ups in the intake

**Decision.** Whether the next turn in a chat says the previous result was wrong. This feeds the `correction` signal (−1.5) in [ANALYTICS_PLAN.md](ANALYTICS_PLAN.md).

Today a follow-up that Jev files as `bug_fix` or `debugging`, after a turn that changed files, counts as a correction. But the intake sees only the new message, so a new, unrelated bug report counts too. Acceptance ("perfect, thanks") is not detected at all.

**Questions.** Add these to the intake batch when the chat has a previous turn. The state gains `previous: { request (≤ 1,000 chars), reply tail (≤ 500 chars, redacted), changed: true | false }`.

- `says_wrong`, a Noul: "Does `task` say the result of `previous` was wrong, incomplete, broke something, or was not what was asked?"
- `new_work`, a Noul: "Does `task` ask for new work unrelated to `previous`?"
- `accepts`, a Noul: "Does `task` accept or thank for the result of `previous` without asking for changes?"

**Gate.**

- A correction when `says_wrong` ≥ 0.75 and `new_work` ≤ 0.4.
- A new positive signal, `accepted` (proposed weight +0.5), when `accepts` ≥ 0.8.
- In between, today's phrase list decides.

**Fallback.** The current `classifyFollowUp`.

**Cost.** About 400 extra tokens on a call we already make, about $0.00002, with no extra round trip.

**Measure.**

- Agreement with explicit feedback (Bad result with reason "Wrong approach" or "Broke something").
- The share of `correction` signals on turns later rated Good. It should fall.
- A 50-turn hand-labelled sample.

**Privacy.** This sends the previous request and a reply tail. The request was already sent on its own turn, so the reply tail is the new data.

---

### 4. Is a Critic needed for this diff?

**Decision.** Whether to run the Critic once the Builders have finished. Today depth is fixed at intake, before any diff exists:

- `execute` runs no Critic unless it is a review request.
- `plan_execute_review` always runs one.

The e2e run showed a Critic costing 3 to 5 times a rules-only run on a spelled-out destructive task, and review requests missing their Critic.

**Questions**, speculative, in the last Builder's transition batch. The state adds `change: { files: [{ path, kind: "test" | "config" | "migration" | "source" | "docs" }], lines: "small" | "medium" | "large" }`, where kinds and buckets come from code.

- `touches_sensitive`, a Noul: "Does `change` touch authentication, permissions, payments, data deletion, database migrations, concurrency or security settings?"
- `behaviour_change`, a Noul: "Does `change` change what existing code does, not only add new code or tests?"
- `builder_unsure`, a Noul: "Does `reply` express doubt, mention a workaround, or leave a TODO?"
- `judgment`, a Score: "How much design judgment did `change` need?". Levels:
  - "Mechanical: the same edit repeated, or a rename"
  - "Contained: one function or file, following existing patterns"
  - "Design: new structure, interfaces or data shapes"

**Gate.**

- Add a Critic at `execute` depth when `touches_sensitive` ≥ 0.8, or `builder_unsure` ≥ 0.8, or `judgment` ≥ 1.5 with confidence ≥ 0.6.
- Drop a planned Critic only when all of these hold:
  - the risk is not destructive
  - checks passed
  - `touches_sensitive` ≤ 0.15 and `builder_unsure` ≤ 0.2
  - `judgment` ≤ 0.5 with confidence ≥ 0.8
- Destructive work always keeps its Critic.

**Fallback.** Today's depth.

**Cost.** About $0.0001, and it saves a Critic run of $0.015 to $0.04 (a Codex Critic) or more (a Claude one) when it drops one.

**Measure.**

- In shadow, run the Critic anyway on 20% of the "not needed" cases and count its concerns (target: under 5%).
- Critic cost per turn.
- Reverts and corrections on turns without a Critic.

**Privacy.** File paths, unless the path is replaced by its kind. Use kinds only unless the user agrees to paths.

---

### 5. Stuck or looping agent

**Built** in harness round 9 (September 27, 2026) as the Jev watchdog, with a fourth question (`finished`) and single-check gating at 0.85; see [JEV.md](JEV.md#watchdog-round-9-september-27-2026). The user approved sending tool-call titles.

**Decision.** Whether a live agent is going nowhere: the same edit and revert, the same failing command, reading the same files, or drifting off its step. Today only the 60-tool-call, 15-minute and cost budgets catch it, after the money is spent.

**Policy change needed.** HARNESS_PLAN says Jev is "never" called during a run. This asks it during a run, for advice only.

**Deterministic first.** Code already knows:

- repeated identical tool calls (the same title and arguments hash three times)
- the same command failing twice
- no plan tick in N tool calls

Those flags are pure and go into the state as buckets. Jev judges only what code cannot.

**Questions**, every 10 tool calls of a Builder or Scout, or on a code flag. The state is `{ step, recent: [last 12 tool-call titles and kinds, paths redacted, no output], flags: [...], progress: "no step ticked" | "step 2 of 3 ticked" }`.

- `repeating`, a Noul: "Is the agent repeating the same actions in `recent` without making progress on `step`?"
- `off_step`, a Noul: "Are the actions in `recent` about something other than `step`?"
- `waiting_on_something`, a Noul: "Do the actions in `recent` suggest the agent is stuck on something outside the code, such as a missing tool, install or permission?"

**Gate.** Two consecutive checks with `repeating` or `off_step` ≥ 0.85 raise a flag.

- At Hands-on and Balanced the flag becomes a "Bolt seems stuck" checkpoint with Continue, Stop and a note.
- At Hands-off and Full auto it becomes a nudge: a follow-up prompt through the session, "You seem to be repeating X; step back and …", with fixed text chosen by code.

Never an automatic Stop.

**Fallback.** The budgets, as today.

**Cost.** About 1,500 tokens per check, about $0.00006. Across 60 tool calls that is $0.0004 per agent.

**Measure.**

- `budget_exceeded` runs, and the tool calls and cost burned before a stop or success.
- False-positive rate: flags where the user chose Continue and the run then passed.
- Time from the first repeat to the flag.

---

### 6. Does the plan cover the request?

**Decision.** Whether the Architect's plan leaves out something the request asked for, before plan approval or before Builders start. Today nothing checks this. At Hands-off the plan runs unseen, and the Architect has invented scope before (e2e n, +54 lines).

**Questions.** This is the select-instead-of-generate pattern (https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook). Code splits the request into its sentences or bullet items, up to 10. For each item:

- `covers_<i>`, a Choice over the plan's step ids plus `none`: "Which step of `plan` does `request_items[i]` get done in?". Criteria are the step texts; `none` is described as "No step does this".
- `extra_<N>`, one Noul per step: "Does `steps.N` do something `request` did not ask for and does not need?"

**Gate.**

- An item is uncovered when `none` is its top choice with probability ≥ 0.6.
- A step is extra when `extra_N` ≥ 0.8.
- Either one adds a line to the plan approval card ("Step 4 isn't in your request", "Nothing covers: add a test"). At Hands-off and Full auto it sends the Architect one fix-up note, once. It never blocks by itself.

**Fallback.** No check, as today.

**Cost.** About 3,000 tokens, $0.00013. It joins the Architect route call's successor, or is one call right after the plan.

**Measure.** Plan edits by the user after the note, lean-build lines added, corrections, and "not what I asked" feedback.

---

### 7. Routing a message sent during a run

**Decision.** What to do when the user writes while a crew is working. Today the message waits as the next turn.

**Questions**, one batch per message. The state is `{ message, active: [{ name, role, step }], phase }`.

- `intent`, a Choice:
  - `steer`: changes what the current work should do
  - `add`: more work for after this
  - `question`: asks about progress or the plan
  - `stop`: wants the work to stop
  - `unrelated`: a new topic

  Each option is described with `what`, `not_for` and `examples`.

- `member`, a Choice over the active members' names plus `all`: "Which agent's work does `message` concern?"
- `urgent`, a Noul: "Does `message` say the current work is wrong or harmful and should change now?"

**Gate.**

- `stop` never acts: it highlights the Stop button.
- `steer` with a top probability ≥ 0.85 and `urgent` ≥ 0.7 delivers the message to that member as a follow-up at its next turn boundary (the session's `followUp` path). Otherwise it queues, as today.
- `question` is answered by code from the orchestration state (the task list), with no agent turn.

**Fallback.** Queue.

**Cost.** About $0.00006 per message.

**Measure.** How often a queued message led to a revert or re-ask, and how often a steered one did. Time from the message to its effect.

---

### 8. Scoping a work order to files

**Decision.** Which files a Builder should be told to read first. Today it gets the files the step names plus the Architect's notes, then searches on its own. Reads before the first edit are a large part of a cold Builder's cost.

**Questions.**

- Code first builds up to 150 candidates: `git ls-files`, filtered by identifiers and words from the step, and the Architect's read list.
- Then one Noul per candidate, with the candidate as structured `instructions` `{ file: { path, exports or first line } }`: "Would a developer need to read or change `file` to do `step`?"
- Also `none_fit`, a Noul: "Is the code needed for `step` missing from all of `candidates`?"

**Gate.** The top 8 by noul with value ≥ 0.6 are added to the Builder prompt as "Likely relevant files". Nothing is removed from what the step names.

**Fallback.** Today's context.

**Cost.** About 9,000 tokens for 150 candidates, $0.0004. Stay under 32k for the state plus the longest question, and cap the candidates at 200.

**Measure.** Builder `Read` calls before the first edit, input tokens, time to the first edit, and pass rate.

**Fit and privacy.** Medium. Jev judges from names and one line, so it is only as good as the candidates. This sends file paths and first lines, which is a clear widening of what we send: it needs the user's yes and a pinned-test update.

---

### 9. What to keep when compacting

**Decision.** When M6 compaction lands and a chat outgrows the 36 KB budget: which earlier turns the new message depends on. _When_ to compact is a size test in code, not a Jev question.

**Questions.**

- One Noul per earlier turn, `{ turn: { request, reply tail } }`: "Does `new_message` depend on `turn`?"
- `topic_shift`, a Noul: "Does `new_message` start a new topic unrelated to the chat so far?"

**Gate.**

- Turns ≥ 0.6 stay verbatim, and the others are summarised. The summary is written by an LLM, not Jev.
- A `topic_shift` ≥ 0.85 suggests Start fresh instead.

**Fallback.** Keep the most recent turns that fit.

**Cost.** About $0.00017 for 20 turns.

**Measure.** Re-asks and corrections after compacted turns; tokens saved.

---

### 10. Which checks are relevant

**Decision.** Which of the project's checks (at most 5) to run after a Builder. Code handles the clear cases: only docs changed means skip tests, and a lockfile change means run them all. Jev handles the rest.

**Questions.** One Noul per check, in the transition batch: "Could the changes in `change` affect the result of `check`?", with the check's command and script name as structured instructions.

**Gate.**

- Skip a check only when the noul ≤ 0.1, and only for mid-plan Builders.
- The final round, and the merged tree after a group, always run every check.

**Fallback.** Run all, as today.

**Cost.** About $0.00003.

**Measure.** Time in checks per turn, and failures caught later by the final round that a skipped mid-plan check would have caught.

**Fit.** Medium. The saving is modest (checks are capped at 120 s) and code rules cover most of it.

---

### 11. Digest and companion priority

**Decision.** Which chats the digest leads with, and how the status companion orders its "needs you" list. Today:

- `endsWithOffer` is a regex.
- The order is fixed by state (waiting, failed, stalled…).
- The digest LLM ranks the chats implicitly.

**Questions**, one batch per digest for up to 20 chats, one question per chat and kind, with the chat as structured instructions:

- `asks_user_<id>`, a Noul: "Does `chat.lastReply` end by asking the user to decide or answer something?" This replaces the regex.
- `urgency_<id>`, a Score:
  - "Can wait: finished, nothing open"
  - "Open work: steps or offers left"
  - "Blocked: failed, stalled or checks failing"
  - "Needs the user now: an approval or question is waiting"
- `unfinished_<id>`, a Noul: "Does `chat` show work the user probably still wants done?"

**Gate.** Sort by urgency score, then recency; use the noul at 0.7. The digest LLM gets the order as data.

**Fallback.** Today's regex and order.

**Cost.** About 6,000 tokens, $0.00025 per digest.

**Measure.** Digest item clicks by position, and the time to open a waiting chat.

**Privacy.** The digest is local today: it runs on the user's own provider. This would send chat titles and reply tails to TypeSafe, so it needs the user's yes. Without it, keep the regex.

---

### 12. Anomaly flags in analytics: a poor fit

ANALYTICS_PLAN's detectors (spend spikes, rate jumps, drift near a gate) are numeric comparisons: a median plus 3 MAD, and rates. The jaggedness page says Jev is weak at numbers, counting and dates, and that arithmetic belongs in code. ANALYTICS_PLAN also says outcomes and aggregates are local only, and nothing is sent anywhere.

Keep the detectors deterministic. The one text task, sorting free-text feedback comments into reasons, is small and would break the local-only rule. Leave it alone unless the user changes that rule.

## Where Jev is a poor fit

Don't use Jev for these:

- **Anything that writes.** Plans, fix instructions, summaries (the digest, compaction, the final reply), titles, commit and PR text, and explanations. The docs say generation "will not work well and will be very slow".
- **Arithmetic, counts, dates and budgets.** Token counts, when to compact, cost caps, time windows and the anomaly maths.
- **Deep code judgment.** Whether a diff is correct, finding bugs or vulnerabilities, resolving merge conflicts. These need multi-step reasoning (System 2); the Critic and the checks do it.
- **Permissions and safety.** Approvals, allowlists, secret-file rules and budgets. This is policy, and Jev must not have authority over it.
- **Decisions code already makes exactly.** File overlap between lanes, the step markers, `package.json` script detection and the retry count.
- **Adversarial text as a boundary.** The injection noul is a filter to record, not a guard.

## Risks

### Latency

- The orchestration timeout is 3 s. We measured 150 to 360 ms, the docs say about 100 ms typical and 70 to 500 ms end to end, and a 62-question batch took 0.51 s.
- Each opportunity above joins an existing call or adds one call per event, so the added wait per turn stays under a second. Items 5 and 7 run beside a live agent and add no wait at all.
- Keep batches under about 60 questions and 10k state tokens. Accuracy falls with irrelevant state before latency does.
- On timeout, every decision falls back to its rule, as today.

### Rate limits

- The limits are 1,200 requests per minute and 250k tokens per second per account, and they are dynamic. Cookbooks hit 429 at about 8 concurrent requests on a shared key.
- Worst case today:
  - 3 orchestrations (`WORKER_CONCURRENCY` at most 3)
  - × 3 parallel members
  - × one stuck check every 10 tool calls, plus transitions

  That can reach 5 to 10 calls in the same second.

- Add a process-wide semaphore of 4 in-flight Jev calls and a per-orchestration budget (for example 60 calls), with stuck checks dropped first when the budget is short.
- Retry 429, 529 and 5xx once when at least 1 s of the 3 s is left, honouring `retry-after-ms`. Otherwise use the rules.
- Record 429s as `rate_limited`, not `failed`, so the analytics can separate them.

### Data sent

| Use                                    | New data sent to TypeSafe                                                                                               | Needs the user's yes                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Today (see [JEV.md](JEV.md#data-sent)) | Plan step text and file paths in the routing, parallel, lane, transition and step-check calls; JEV.md lists every field | Approved by the user on September 27, 2026   |
| 1, 2 Builder steps and Lead facts      | Step text, `Done when` lines, reply tail (already sent), check result bucket                                            | No (same class as today)                     |
| 3 Corrections                          | The previous request and a 500-character reply tail                                                                     | No (same class)                              |
| 4 Critic need                          | Changed file kinds (paths only with consent), size bucket                                                               | Only for paths                               |
| 5 Stuck (built)                        | Tool-call titles and kinds, with paths, no output                                                                       | Approved on September 27, 2026               |
| 6 Plan coverage                        | Request sentences, plan steps                                                                                           | No                                           |
| 7 Mid-run messages                     | The message, member names and steps                                                                                     | No                                           |
| 8 File scoping                         | File paths and first lines                                                                                              | Yes                                          |
| 9 Compaction                           | Earlier requests and reply tails                                                                                        | Yes: history is on today's "never sent" list |
| 11 Digest                              | Chat titles and reply tails across chats                                                                                | Yes                                          |

Every new field must be pinned in a `*-questions.test.ts`, as JEV.md requires. Keep redacting paths, keep the 8,000-character caps, never send tool output, diffs or credentials, and keep ZDR (enterprise only) in mind. Routing through OpenRouter or Vercel AI Gateway would add a third party, so don't.

### Batching

The target is at most one Jev round trip per orchestration event:

- **Intake:** today's questions, plus `build_style` (speculative over all three styles, with code keeping the allowed ones), the corrections (3), and the Architect route (speculative).
- **After the plan:** the planned routes, parallel, lanes and plan coverage (6), in one call. Today these are two calls.
- **After each agent:** the Lead facts (2), step completion (1), check relevance (10), and the Critic need (4) speculatively after the last Builder.
- **During an agent:** stuck checks only (5).
- **Per mid-run message:** one call (7).

Each batch shares one state, so a question that needs a different state (a per-file candidate list, for example) is a separate call. That is the only reason to split.

### Quality drift

`jev-latest` will move. Pin `jev-1.13.0` while gates are tuned, store `response.model` on every row, and re-run the live intake test and a shadow week before moving to a new version.
