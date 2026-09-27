# Lead mode

> **Future design, not planned.** Round 10 removed the pieces this design builds on (the Architect, work orders, the plan-session handoff, lanes and worktree groups; recoverable from checkpoint `06db4c6`). The next step for large work is a branch and worktree per task, not a Lead. Revisit only when a large-task benchmark shows one Builder falling short. See [HARNESS_PLAN.md](HARNESS_PLAN.md#removed-in-round-10).

A design for large tasks, written on September 27, 2026. Nothing here is built. It follows [Round 8: work orders](HARNESS_PLAN.md#round-8-work-orders-september-27-2026), which built the pieces a Lead needs (work orders, continuing a worker's session, reviewers that get a diff and a contract, read counts), and it leans on [JEV_OPPORTUNITIES.md](JEV_OPPORTUNITIES.md) for the Jev questions, most of all opportunity 2, "Lead decisions as atomic facts".

The idea comes from Omnigent's Polly orchestrator (read from its repository: `examples/polly/config.yaml`, the `fanout` and `cross-review` skills, and `SysSessionSendTool` in `omnigent/tools/builtins/spawn.py`). We took the ideas, not the code or prompts.

## What Polly does

- **A Lead that never codes.** Polly's brain plans, splits work and delegates every code change, investigation and review to named sub-agents (Claude Code, Codex and others), each in its own git worktree.
- **Scoped work orders.** Each dispatch carries the task, an acceptance contract, the worktree path and the gates that must be green.
- **Named workers.** `sys_session_send(agent, title, args)` creates a worker the first time and continues the same conversation for the same `(agent, title)` later, so a fix goes back to the worker that has the context.
- **Asynchronous results.** Workers run to completion on their own and post to an inbox. The Lead ends its turn and is woken when something arrives, so it never polls and its own context stays small: it reads structured results, not transcripts.
- **Independent review.** A reviewer from another vendor gets only a saved diff and the contract, never the worker's transcript or worktree. Blocking issues go back to the same worker as fix tasks.
- **The human merges.** Polly pulls the human in at the plan gate and on hard blocks.

Everything in Polly's loop is an LLM turn: which worker, is it done, retry or escalate, ask the human. We already make most of those decisions in code, and Jev answers the judgment calls for about $0.0001 in 0.15–0.5 s, against $0.01–0.02 and 3–10 s for a Haiku or Sonnet turn (JEV_OPPORTUNITIES, "Why more Jev"). So our Lead is mostly code and Jev, and an LLM only where text has to be written or Jev is unsure and no rule applies.

## Why a Lead, and why only for large tasks

Today's orchestrator is a state machine over a one-shot plan: intake, Architect, Builders by step or lane, checks, Critic, keep. It works well up to about six steps and two or three lanes. It breaks down when:

- **The plan meets a surprise.** A Builder finds the plan wrong ("the table has no `created_at`"). Today it fails or asks for a retry one tier up; nobody re-plans.
- **Work is long.** Plans are batched into at most 4 Builder steps (`MAX_BUILDERS`), lanes are capped by `ORCHESTRATION_PARALLEL_LIMIT` (3), and there is one plan per turn.
- **The user writes during the run.** Every mid-run message waits as the next turn (JEV_OPPORTUNITIES 7).
- **Results come back out of order.** Lanes and queued reviews already run concurrently, but the flow waits for a whole group before deciding anything.

Small and medium work should keep today's flow. Round 8 made it cheaper, and a Lead adds decisions and latency for no gain there.

## Shape

```text
             user message ─┐        ┌─ Agent TV, companion, work panel
                           ▼        │
   ┌──────────────── lead_events (inbox, Postgres) ───────────────┐
   │ worker finished · failed · asked · checks done · review done │
   │ merge conflict · budget · stuck flag · user message          │
   └───────────────────────────────┬──────────────────────────────┘
                                   ▼  NOTIFY lead_events, 1 s poll backup
                   leadStep(state, event)   (code)
                      │  one Jev batch per event (facts)
                      │  pure leadDecision(facts, state, level)
                      │  LLM Lead turn only for text, or when unsure
                      ▼
      dispatch · continue · review · ask · re-plan · wait · finish
                      │
   workers (child runs): Scout · Builder · Critic, named, with work orders,
   resumeKey = ${taskId}:${role}:${name}, in the main tree or a worktree
```

- **The Lead loop is code.** `leadStep` handles one inbox event at a time, like `nextStep` in `transitions.ts` handles one flow event. It keeps a registry of work orders and workers in Postgres (Polly keeps `.polly/registry.json`).
- **Workers are today's crew members.** A dispatch is `runMember` with a work order and a `Place`; the only change is that the Lead does not await it. When the child run ends, the member's landing (checks, fix-up, queued review) runs as today, and the result is posted to the inbox.
- **The inbox** is a new table, `lead_events (orchestration_run_id, seq, kind, member_run_id, work_order, body, created_at, handled_at)`, written in the same transaction as the child's final run event. The Lead waits on `NOTIFY lead_events` with a 1 s poll, the pattern `approval-gate.ts` uses. It survives restarts, and it is what Agent TV and the work panel read.
- **Named workers continue by name.** Polly's `(agent, title)` is our `resumeKey`. A follow-up for Bolt's work order is a spawn with Bolt's name and key and a short `followUp`; M6 resumes the session when the provider, model, effort, mode and folder match, and otherwise starts fresh with the full work order (round 8's fallback). Escalating one tier up is a new session by design and keeps the name ("Bolt, now on Opus").
- **The LLM Lead** is a crew member of its own (role `lead`, a name such as "Marshal", Haiku 4.5 or Sonnet 5 at low effort, chosen by the usual routing gate). It runs with no tools, in Chat mode, with its own `resumeKey` `${taskId}:lead`, so each turn sends only the new events. It answers in a fenced JSON block that a zod schema validates. What it can say is limited to the same actions code can take; anything else is dropped and logged.

## Maximising Jev

Every routine Lead decision is a Jev question with a pure rule behind it. Code owns the flow; Jev answers facts; the LLM Lead writes text. The questions below come from JEV_OPPORTUNITIES (numbers in brackets); the gates are its bands, and below a band the named rule decides.

| Decision                     | Jev facts (one batch per event)                                                                                          | Rule when Jev is unsure                                 | LLM Lead only when                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Is the result complete?      | `step_done_N`, `step_left_N`, and `criterion_unmet_N_i` over the work order's `Acceptance` lines [1]                     | step markers and `firstOpenStep`; a failed check wins   | never                                                                         |
| Next action                  | none: code picks the next open work order whose dependencies are done, the Critic [4], or finish                         | plan order                                              | never                                                                         |
| Which worker                 | `continues_work_of` (Choice over the active and finished workers plus `new`): "Whose work does this follow-up continue?" | same lane or same changed files → that worker; else new | never                                                                         |
| Retry, escalate or ask       | `reports_error`, `gave_up`, `stronger_needed`, `failure_kind`, `env_problem` [2]                                         | today's transition rules (retry one tier up, at most 2) | a fix instruction must be written for the retry                               |
| Ask the human                | `needs_user`, `env_problem` [2]; may only add a checkpoint                                                               | the involvement table                                   | the question to the user must be worded                                       |
| Re-plan                      | `plan_wrong` [2], plus `order_still_valid_N` per open work order: "Does `finding` make `order` wrong or unnecessary?"    | no re-plan; retry, then ask                             | always: the new or changed work orders are written by the LLM Lead            |
| Review needed?               | `touches_sensitive`, `behaviour_change`, `builder_unsure`, `judgment` [4]                                                | today's depth                                           | never                                                                         |
| Stuck worker                 | `repeating`, `off_step`, `waiting_on_something` [5], with code's own repeat flags                                        | the budgets                                             | never; the nudge text is fixed by code                                        |
| User message: queue or act   | `intent` (steer, add, question, stop, unrelated), `member`, `urgent` [7]                                                 | queue as the next turn, as today                        | a `question` code cannot answer from the task list; an `add` to be written up |
| Steer now or at the boundary | `urgent` [7] and `member`                                                                                                | at the member's next turn boundary                      | never                                                                         |
| Is a Lead needed at all?     | see "When Jev turns it on"                                                                                               | off                                                     | never                                                                         |

- **One call per event.** Each inbox event gets one Jev batch with all the facts that could matter for it, speculative ones included, as JEV_OPPORTUNITIES' batching section says. Expected load for a 10-work-order task: about 25–40 Jev calls, $0.003–0.005 in total.
- **The LLM Lead is asked at most** once for the initial split when the Architect's plan needs more than 6 work orders, once per re-plan, once per mid-run message that needs an answer or new work written, and once for the final summary when more than one worker contributed. A 10-order task with one surprise and one user message should take 3–5 Lead turns, about $0.02–0.06 on Haiku or Sonnet low. Polly would take one turn per inbox event, about 20–30.
- **Jev unsure is not a Lead call by itself.** Below the band the rule decides, as today. The LLM Lead is only asked when there is no rule (a re-plan) or text must be written.
- **Shadow first.** As JEV_OPPORTUNITIES rule 7 says, each new fact is recorded next to the rule's answer (`run_advice` with purpose `lead`) before it acts.

## How it fits what we have

- **Crew and names.** Workers keep the role pools (Bolt, Rivet, Tack…). The Lead appears as its own member with the role subtitle "Lead", in the Crew tab and in the crew blocks. Jev keeps the dispatcher role.
- **Work orders.** The Architect still writes the plan and the work orders (round 8). The Lead dispatches them. Orders the LLM Lead writes on a re-plan use the same fenced format and the same parser, capped at 6 KB each. The Lead never writes excerpts: it has not read the code. A re-plan that needs reading goes to the Architect, resumed on its own key.
- **Approvals.** Unchanged. Each worker's edits and commands go through M2's gate in its own copy, titled "· Bolt's copy". The Lead has no tools and never answers an approval. Its JSON can only request actions that code already allows, so it cannot widen a mode, skip a check, extend a budget or mark work verified. Plan approval happens at the plan gate as today; a re-plan asks again at Hands-on and Balanced and is recorded at Hands-off and Full auto.
- **Checks.** The harness runs the project's checks after every landed work order (`land()`), and once on the merged tree after each wave. The work order's `Checks` line is the Architect's expectation; the Lead cannot remove a project check. A failed check is an inbox event, and the one fix follow-up (`CHECK_FIXES`) still goes to the same worker by key.
- **Worktrees and placement.** Round 7's placement rules decide shared tree or worktree per wave. Merges stay in plan order (`merge.ts`), and a conflict is an inbox event that raises the `merge_conflict` checkpoint. A worker continued by name keeps its copy (`route.worktreeRun`).
- **Reviews.** The Critic keeps getting only the diff and the acceptance contract, from the other provider when one is connected. Blocking findings become a follow-up to the same worker by key, as Polly's cross-review loop does, at most twice per order, then the retry card.
- **M6 resume.** Workers, the Critic, the Architect and the Lead all resume by key. The Lead's own context stays small: each turn gets the new inbox events as a compact digest (member, order, outcome, the Jev facts, check lines, the diff stat, the contract), never a transcript.
- **Budgets.** Tool calls, active time and cost add up across the Lead and every worker. The Lead's LLM turns count like any member. Jev calls get the per-orchestration cap and the process-wide semaphore of 4 from JEV_OPPORTUNITIES' rate-limit section.
- **Stop and recovery.** Stop cancels every active worker and the Lead turn, as today. A crash leaves the orchestration `outcome_unknown`; inbox rows and the registry survive, so a later "continue" can show what was done and what was open. Nothing is replayed.
- **Agent TV.** The Lead sits in the center next to Jev. Inbox events animate as arrows into the center; a dispatch animates out to a worker. Workers waiting in a wave show as idle, and a stuck flag gives that worker's blob the alert expression.
- **The companion and the work panel.** The companion's status line gains Lead states: "Lead is waiting on Bolt and Rivet", "Lead re-planned after Tack's finding", "Your message was sent to Bolt". The work panel's Tasks tab lists the work orders with their worker, state and contract, and a mid-run message shows where it went (queued, steered to Bolt, answered).
- **Mid-run messages.** A message sent while a Lead-mode orchestration runs is not queued blindly as the next turn. It becomes an inbox event: `question` is answered from the registry by code (or by the LLM Lead when code cannot), `steer` goes to the member as a `followUp` at its next turn boundary, `add` becomes new work orders for after the current wave, `stop` highlights Stop and never acts, and anything unsure queues as today.

## When Jev turns it on

Lead mode is decided after the Architect's plan, not at intake, because the plan shows the size. Rule first, then Jev, recorded as a `lead` decision with both answers.

- **The rule turns it on when** any of these hold:
  - the plan has more than 6 steps (today they would be batched into 4 Builders);
  - it has 3 or more lanes;
  - Jev's scope is "across the codebase" and its complexity is "complex", both trusted;
  - the task already had a Lead turn and the user asks to continue it.
- **Jev can turn it on or keep it off** with one noul in the post-plan batch, at the usual 0.75 certainty: "Will `plan` probably need changing once the work starts (unknowns, migrations, several modules that depend on each other)?" A sure yes turns it on for a plan of 4 or more steps; a sure no keeps it off even when the step count alone would turn it on.
- **Never** for Ask or Chat, for plans of 3 steps or fewer, or when the chat's level is Hands-on (every decision would ask anyway).
- **The user** can force it per chat, from the plan approval card: "Run with a Lead".
- **Shadow first.** Until the benchmark below supports it, the decision is recorded and the flow stays as today.

## Phases

1. **L0, shadow facts.** Ask the Jev facts on today's flow after each agent and record them (`purpose: lead`). Measure agreement with the rules and with outcomes. This is JEV_OPPORTUNITIES 1 and 2 in shadow.
2. **L1, inbox and asynchronous dispatch in code.** `lead_events`, `leadStep`, dispatch without awaiting, waves by dependency, continue by name, contract-based completion. No LLM Lead yet: a re-plan goes to the Architect, resumed.
3. **L2, the LLM Lead.** Re-plans that need no reading, fix instructions, answers to the user, the final summary.
4. **L3, mid-run messages** routed through the inbox.
5. **L4, Jev turns it on** after the benchmark.

Each phase ships on its own with unit tests for the pure parts (`leadDecision`, the registry, the event mapping), DB tests with the fake agent (out-of-order results, a failing worker, a plan-wrong finding, a steer message, Stop mid-wave, a crash with events pending), and a browser test for the Lead's crew block and the companion line.

## Benchmark

- **Tasks** (new fixtures in `scripts/bench` and `scripts/e2e-live`, each with hidden checks):
  - **W1, wide feature:** three independent modules and a shared join step (about 9 steps, 3 lanes).
  - **W2, surprise:** a migration whose plan assumes a column that does not exist; the right move is a re-plan after step 2.
  - **W3, long chain:** 10 dependent steps across 6 files (today batched into 4 Builders).
  - **W4, steer:** W1 with a scripted user message 30 s in: "use `Intl.DateTimeFormat`, not a hand-written formatter".
  - **Controls:** P1 and H1 from the live run, to show Lead mode stays off or does no harm.
- **Arms:** today's flow (round 8); Lead mode with Jev facts and the LLM Lead only for text; Lead mode with an LLM for every decision (Polly-like, same model); direct Claude (Sonnet 5, medium). n=2, then n=3 for anything within 1.3×.
- **Metrics:** hidden-check pass rate; cost and wall time; the Lead's LLM turns and cost; Jev calls and cost; decisions by source (rule, Jev, LLM); re-plans and whether they were needed; Builder file reads and re-reads (round 8's counts); time from a user message to its effect; checkpoints raised; merge conflicts.
- **Success:** on W1–W4, pass rate at least today's and at least direct Claude's; cost within 1.5× of direct Claude on W1 and W3; W2 passes where today's flow fails or retries; W4's steer lands within one worker turn; the Jev-first Lead uses at most a third of the Polly-like arm's Lead cost at the same pass rate. On P1 and H1, Lead mode stays off.

## Risks and open questions

- **Concurrency bugs.** Asynchronous dispatch adds out-of-order events, cancellation races and double handling. Mitigation: one inbox row per event with `handled_at`, handled under the orchestration's lease, and `leadStep` pure.
- **Lead drift.** An LLM Lead that re-plans too often burns money. Re-plans are capped at 2 per orchestration and ask at Hands-on and Balanced.
- **Context for re-plans.** The Lead has not read the code, so a re-plan that needs reading goes back to the Architect's resumed session. That session may have gone idle (30 minutes); then it starts fresh with the original plan and the finding.
- **Data sent to Jev.** The Lead facts send step text, acceptance lines and reply tails, the same class as today (JEV_OPPORTUNITIES, "Data sent"). Mid-run messages are new text; stuck checks send tool titles and need the user's yes.
- **Open:** should a Lead-mode task open a PR per lane, as Polly does, or keep today's single keep card with per-lane changes? This design keeps the keep card; PRs stay the user's job.
