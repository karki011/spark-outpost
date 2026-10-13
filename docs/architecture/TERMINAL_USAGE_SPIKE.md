# Terminal usage spike

Status: experiment on `spark/terminal-usage`, not released. It reverses the documented rule that Spark records only a Terminal session's start, mode and observed state. AGENTS.md and the guide still state that rule; they change only if the owner decides to ship this.

Measured against Claude Code 2.1.296 and Codex CLI 0.157.0. Neither file format is a documented interface. A CLI that changes it returns the affected number to "unknown".

## What is recorded

| What                                                                         | Where                                                                         | Source                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One step per tool call: tool name, tool id, sub-agent id, start, end, failed | `native_terminal_steps` (migration 0168)                                      | The CLI's own hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| Tokens per turn (input, output, cache read, cache write, thinking), model    | `runs` token columns and `used_model` of the turn's run                       | Claude session file, Codex rollout file                                |
| Estimated cost per turn                                                      | `runs.cost_usd` with `cost_source = 'estimated'`                              | Tokens × the model card price                                          |
| The CLI's own session total and per-model totals                             | `native_terminal_reported_usage` (migration 0169), one row per CLI session id | Claude `cost-state` record. Codex has none                             |

Not recorded: tool input, tool output, commands, paths, prompt or reply text, transcript paths. Tool names, ids and model names pass through the audit redaction and are cut to 200 characters. Nothing here delays or blocks the CLI: the hook script still exits silently on any failure, and a read that fails leaves the number unknown.

## Steps

The hook script now forwards `tool_use_id`, `agent_id` and `model`. A step is created on `PreToolUse` and closed on `PostToolUse` or `PostToolUseFailure` with the same tool id. Pairing is by id only: a tool event without an id stores nothing, and an end without a start has no start time. Steps belong to the turn that is open when the hook arrives. A tool call by a sub-agent carries the sub-agent's id and is filed under the open turn.

Steps appear as the turn's activity in the conversation detail, so the Island shows them with the names chats use ("Running a command"), and in the Work panel's Steps tab.

## Claude tokens per turn

`native-tail.ts` is the one file reader (it replaced the interrupt tailer): 200 ms `watchFile` polling, only while a turn is open. The first watcher of a launch starts at the end of the file, so a resumed session never replays history. Each later turn continues from where the previous watcher stopped. A file that shrank is skipped to its new end. An unfinished last line waits for the rest.

`claude-transcript.ts` reads `assistant` records. Usage is counted once per `message.id` (two tool calls in one response are two records with the same id and usage), per model, for the prompt the record follows (`promptId` of the last `user` record). A record of another prompt is ignored. `<synthetic>` zero-usage records, sidechain records and unknown record types are ignored.

Cost is tokens × the model card price. A one-hour cache write is priced at twice the input price (Anthropic's published rule; the card holds only the five-minute rate). This reproduces Claude Code's own per-model cost exactly for Opus 5.5: 2 in, 4 out, 28,918 cache read, 9,419 one-hour cache write gives $0.081224 against `costUSD` 0.0812236. A model without a card price leaves the turn's cost unknown; its tokens are still stored.

## Claude session total

Claude Code writes `cost-state` only when it exits, twice per exit, never after a turn, when idle or on `/cost`. After Resume the same file and session id continue and the totals continue cumulatively (0.4036 → 0.4282 in the sample). The rule is therefore: keep the last `cost-state` per CLI session id; never sum records of one id; sum across the CLI session ids of one Spark session. A record whose `sessionId` is not the file's own is ignored. The file is read once more when the CLI process exits, and again at the start of the next turn.

The session total and the turn estimates are never added together. An open session has no reported total; the Cost tab says so.

## Accuracy against the CLI's own total

Sum of per-turn estimates against the last `cost-state` of the same file:

| Sample                                                     | Turns | Estimate sum | `cost-state` | Share |
| ---------------------------------------------------------- | ----- | ------------ | ------------ | ----- |
| one plain turn                                             | 1     | $0.081224    | $0.081352    | 99.8% |
| three plain turns                                          | 3     | $0.254528    | $0.268160    | 94.9% |
| one turn, two tool calls                                   | 1     | $0.162254    | $0.175234    | 92.6% |
| three turns, one tool call                                 | 3     | $0.236280    | $0.262432    | 90.0% |
| one turn, two tool calls, long idle                        | 1     | $0.138354    | $0.161482    | 85.7% |
| five turns: tools, background sub-agent, interrupt, resume | 5     | $0.224038    | $0.428200    | 52.3% |

The estimate is a lower bound. Claude Code makes requests that leave no `assistant` record: in the last sample Opus input is 18 tokens in the files against 1,534 in `cost-state`, output 710 against 1,314, cache read 265,645 against 351,598, and Haiku 5.5 appears only in `cost-state`. An interrupted reply records `output_tokens: 2` although much more had streamed. In that sample the background sub-agent's own file would add $0.161 (bringing the share to about 90%), but its hooks arrived after the parent turn's `Stop`, so it is not counted (see sub-agents).

## Codex

The Codex hook payload carries the rollout path as `transcript_path`; it is now kept when the file name is `rollout-…-<thread id>.jsonl` for the thread id the same hook reports. Nothing is scanned.

`codex-rollout.ts` reads `token_usage_record`. A turn takes its last `turn_token_usage`, the CLI's own running total for the turn, rather than the sum of per-response `usage`: a missed or repeated line cannot double count, and the two were checked equal (16,998 + 17,037 = 34,035). `thread_token_usage` is not used. `input_tokens` includes cached tokens, and the price function subtracts them. The model comes from `turn_context`, or from the hook's `model` when the reader started after that record.

Turn totals in the sample equal the rollout's own: 34,035, 17,403 and 53,125 tokens. Codex writes no cost anywhere, so the cost is an estimate only ($0.051926, $0.013922, $0.029425 at the GPT-5.6 Sol card price) and there is no reported total.

## Sub-agents

A sub-agent's records are in their own file. Spark reads that file only when a hook names it, from its start, and only until the open turn closes:

- Claude: `<session folder>/<session id>/subagents/agent-<agent id>.jsonl`, built from the `agent_id` of a tool hook. Its records count toward the prompt they carry.
- Codex: the child thread's rollout, named by the hook's `transcript_path` when the file name ends with the hook's `agent_id`. Its token records carry `root_turn_id`, the parent turn. The copied parent history at the top of the file has no token records. Parent 53,125 + child 35,617 = 88,742 for the turn, and 140,180 for the session, which matches the sum of both thread totals.

Limit: a Claude sub-agent that runs in the background reports its tool calls after the parent turn's `Stop`. Spark has closed the turn by then, so those steps and tokens are dropped. They are inside the session total. Keeping a turn open for a pending background agent, or filing late usage under a closed run, was not built.

## Labels and where the numbers show

Every figure names its origin: "estimated from tokens", "reported by Claude Code", or "unknown" (never zero) when there is no data.

- Work panel of a Terminal session: a Steps tab (turn, tool, duration, failed, sub-agent) and a Cost tab (tokens and estimated cost by turn, the session total when present). A Terminal session without a task had no Work panel before; it now has one with these two tabs.
- Island: the session's activity lines show the steps.
- Everything that already sums `runs.cost_usd` now includes Terminal turns: the chat's usage totals, Analytics Spend, Home, the audit cost export. Spend marks the provider total as estimated or mixed, but a Terminal estimate is not distinguishable there from a chat estimate.

## Open questions

1. Ship or not. If it ships, AGENTS.md, `NATIVE_TERMINALS.md` and the guide pages on Terminal sessions and on what Spark records need the new rule, and What's new needs a row.
2. Should estimated Terminal cost count in Analytics Spend? For a subscription login it is not a bill. Today it is included and only marked estimated.
3. Spark's Stop reads the file once more and then sends SIGHUP (SIGKILL after 1.5 s). Whether Claude Code writes `cost-state` on SIGHUP was not tested. If it does, the record lands after that read and is missed, because Resume starts at the end of the file.
4. Background sub-agents that outlive their turn (above).
5. A turn started by a sub-agent's handback or a task notification has its own prompt id. Its usage is counted only if Claude Code fires `UserPromptSubmit` for it.
6. Compaction, for both agents; Codex resume; Codex tool kinds other than `exec` and the collaboration calls; a Codex response interrupted before it finished.
7. `/clear` starts a new CLI session id in the same process. Whether its `cost-state` starts from zero is unknown; if it carries the earlier total, summing across ids double counts.
8. The Sonnet 5.5 card lists cache reads at $0.20 per million; two chat session files imply Claude Code charges $0.10. Estimates for that model ran 2–17% above the CLI total.
9. Long-context and fast-mode prices are not modelled.

## Tests

- `native-tail.test.ts`: appended lines only, late-created file, continue from a position, partial last line, truncated file, closed watcher, failing handler.
- `claude-transcript.test.ts`, `codex-rollout.test.ts`, `turn-usage.test.ts`: parsers and the accumulator against reduced copies of the real files in `apps/server/test/fixtures/terminal-usage/` (structure, ids and numbers kept; attachments and all text removed), including the undercount, repeated ids, interrupt, resume, sub-agent files and unknown records.
- `native-terminal-steps.db.test.ts`, `native-terminal-usage.db.test.ts`: steps, tokens, cost and the session total on real runs through the authenticated hook endpoint.
- `tests/browser/native-terminal-usage.spec.ts`: a fixture CLI that calls the real hook script and writes a session file; checks the Steps and Cost tabs before and after exit.

No real provider turn was run with this branch's code.
