# Terminal usage

A Terminal session runs the provider's CLI directly. Spark records the session's start, mode and observed state, and also what this page describes: the tool names and times of its steps, token counts, model and cost per turn read from the CLI's own session file, and the CLI's own session total. It records the user's typed message as the chat's message and never records commands, paths, replies or tool output; a paired device can read replies and tool calls from the session file to show them, and Spark does not store them. Spark's approval cards, protected-path rules and ran-without-review audit still do not apply inside a Terminal session.

Measured against Claude Code 2.1.296 and Codex CLI 0.157.0. Neither file format is a documented interface. A CLI that changes it returns the affected number to "unknown".

## What is recorded

| What                                                                         | Where                                                                         | Source                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One step per tool call: tool name, tool id, sub-agent id, start, end, failed | `native_terminal_steps` (migration 0168)                                      | The CLI's own hooks: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| Tokens per turn (input, output, cache read, cache write, thinking), model    | `runs` token columns and `used_model` of the turn's run                       | Claude session file, Codex rollout file                                |
| Estimated cost per turn                                                      | `runs.cost_usd` with `cost_source = 'estimated'`                              | Tokens × the model card price                                          |
| The CLI's own session total and per-model totals                             | `native_terminal_reported_usage` (migration 0169), one row per CLI session id | Claude `cost-state` record. Codex has none                             |

The session row also keeps the session file's path and the position Spark has read up to (migration 0170).

Not recorded: tool input, tool output, commands, paths the agent touched, reply text. Tool names, ids and model names pass through the audit redaction and are cut to 200 characters. Nothing here delays or blocks the CLI: the hook script still exits silently on any failure, and a read that fails leaves the number unknown.

## Steps

The hook script forwards `tool_use_id`, `agent_id` and `model` when each is a string of at most 200 characters; one of another shape is left out and the event is still reported. It never forwards `tool_input`, `tool_response` or `cwd` with an event, still waits at most one second twice for it, and exits silently on any failure. For a `PermissionRequest` it then sends the tool name and input to the hook host's `/permission` address, held in memory only while the approval is open, and prints a decision only when a paired device gave one (`native-hook-script.test.ts`). A step is created on `PreToolUse` and closed on `PostToolUse` or `PostToolUseFailure` with the same tool id. Pairing is by id only: a tool event without an id stores nothing, and an end without a start has no start time. Steps belong to the turn that is open when the hook arrives. A tool call by a sub-agent carries the sub-agent's id and is filed under the turn that started the sub-agent, also after that turn has closed.

Steps appear as the turn's activity in the conversation detail, so the Island shows them with the names chats use ("Running a command"), and in the Work panel's Steps tab.

## Claude tokens per turn

`native-tail.ts` is the one file reader (it replaced the interrupt tailer): 200 ms `watchFile` polling, only while a turn is open. The position is fixed the moment a hook first names the file: its size then, or zero when the file or its folder does not exist yet, so a first turn that is over before the file was ever polled is still read in full. A turn that had no watcher (the folder appeared after the prompt) is read once when it closes. Each later turn continues from where the previous read stopped, and that position is stored with the session, so a resumed session continues from it: nothing written while Spark was not watching is lost. Nothing is counted twice, because after a resume only records of a turn Spark opened in this launch count, usage is kept per `message.id`, and the last `cost-state` wins. A file that shrank is skipped to its new end. An unfinished last line waits for the rest.

`claude-transcript.ts` reads `assistant` records. Usage is counted once per `message.id` (two tool calls in one response are two records with the same id and usage), per model, for the prompt the record follows (`promptId` of the last `user` record). Usage for an earlier turn of this launch updates that turn's run after the fact. Usage read before Spark has the turn's run (the file was read before the prompt hook was handled) is held and filed when the run exists; it is never dropped because of timing.

A turn is a prompt the user typed. Claude Code fires `UserPromptSubmit` also for a sub-agent's handback and for a task notification, and the hook carries no origin; the prompt record does (`origin.kind`, `human` for a typed prompt), but it reaches the file after the hook (about 1.5 s later in the samples). Spark therefore opens a run on every `UserPromptSubmit`, so a typed prompt has its run before its reply, and takes the run back when the file's record for that prompt id says it was not typed: the run and its message are deleted, and its steps and usage are filed under the originating turn. That turn is the one that started the sub-agent named in `origin.from`, else the typed prompt with the record's `turnPosition.promptIndex`, else the last typed prompt. Until the record is read, such a prompt is listed as a turn for a moment. If the record never appears, it stays a normal turn. Replies are attributed by the prompt record they follow in the file, never by which turn is open.

Cost is tokens × the model card price. A one-hour cache write is priced at twice the input price (Anthropic's published rule; the card holds only the five-minute rate). This reproduces Claude Code's own per-model cost exactly for Opus 5.5: 2 in, 4 out, 28,918 cache read, 9,419 one-hour cache write gives $0.081224 against `costUSD` 0.0812236. A model without a card price leaves the turn's cost unknown; its tokens are still stored.

## Claude session total

Claude Code writes `cost-state` only when it exits, twice per exit, never after a turn, when idle or on `/cost`. After Resume the same file and session id continue and the totals continue cumulatively (0.4036 → 0.4282 in the sample). The rule is therefore: keep the last `cost-state` per CLI session id and never sum records of one id. A record whose `sessionId` is not the file's own is ignored.

The file is read once more after the CLI process has exited, whether it exited by itself or after Spark's Stop (SIGHUP, then SIGKILL after 1.5 s). If that read does not happen, the stored position lets the next Resume pick the record up. Claude Code sometimes writes `cost-state` when Spark's Stop ends it (1 of 4 observed stops); when it does not, the Cost tab says so and only the estimates by turn exist.

`/clear` starts a new CLI session id and a new file whose total starts from zero (observed: $0.0814 in the first file, $0.1121 in the second). When a hook names a new session file, Spark reads the earlier file once more, and again when the process exits. Totals are stored per CLI session id. The Cost tab shows their sum as the session total, with one line for each id under it.

When a session that is not running is opened and its stored position is behind the file, Spark reads the rest once per app run and stores a total found there. That read can store only the reported total: turns are matched to runs only while the session is live.

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

The estimate is a lower bound. Claude Code makes requests that leave no `assistant` record: in the last sample Opus input is 18 tokens in the files against 1,534 in `cost-state`, output 710 against 1,314, cache read 265,645 against 351,598, and Haiku 5.5 appears only in `cost-state`. An interrupted reply records `output_tokens: 2` although much more had streamed. In that sample the background sub-agent's own file is $0.161 of the estimate; without it the share is 52.3%.

## Codex

The Codex hook payload carries the rollout path as `transcript_path`; it is now kept when the file name is `rollout-…-<thread id>.jsonl` for the thread id the same hook reports. Nothing is scanned.

`codex-rollout.ts` reads `token_usage_record`. A turn takes its last `turn_token_usage`, the CLI's own running total for the turn, rather than the sum of per-response `usage`: a missed or repeated line cannot double count, and the two were checked equal (16,998 + 17,037 = 34,035). `thread_token_usage` is not used. `input_tokens` includes cached tokens, and the price function subtracts them. The model comes from `turn_context`, or from the hook's `model` when the reader started after that record.

Turn totals in the sample equal the rollout's own: 34,035, 17,403 and 53,125 tokens. Codex writes no cost anywhere, so the cost is an estimate only ($0.051926, $0.013922, $0.029425 at the GPT-5.6 Sol card price) and there is no reported total.

## Sub-agents

A sub-agent's records are in their own file. Spark reads that file only when a hook names it, from its start:

- Claude: `<session folder>/<session id>/subagents/agent-<agent id>.jsonl`, built from the `agent_id` of a tool hook. Its records carry the prompt id of the turn that started it.
- Codex: the child thread's rollout, named by the hook's `transcript_path` when the file name ends with the hook's `agent_id`. Its token records carry `root_turn_id`, the parent turn. The copied parent history at the top of the file has no token records. Parent 53,125 + child 35,617 = 88,742 for the turn, and 140,180 for the session, which matches the sum of both thread totals.

A background sub-agent finishes after its parent turn's `Stop`. Its steps and tokens are still filed under the run of the turn that started it, and that run's tokens and estimated cost are updated after the fact. The turn is not held open and its status does not change. The link is the `toolUseResult.agentId` record Claude writes in the main file for the Agent call (it carries the turn's prompt id), or the turn that was open when the first hook with that agent id arrived. A late sub-agent call that no turn of this launch started is dropped.

A sub-agent's file is followed until its `SubagentHandback` call ends (Claude) or the session ends. Spark keeps the per-turn tallies of the last 64 turns of a launch in memory for this.

## Labels and where the numbers show

Every figure names its origin: "estimated from tokens", "reported by Claude Code", or "unknown" (never zero) when there is no data.

- Work panel of a Terminal session: a Steps tab (turn, tool, duration, failed, sub-agent) and a Cost tab (tokens and estimated cost by turn, the CLI's total for each CLI session id when present). A Terminal session without a task has a Work panel with these two tabs.
- Island: the session's activity lines show the steps.
- Everything that already sums `runs.cost_usd` now includes Terminal turns: the chat's usage totals, Analytics Spend, Home, the audit cost export. Spend marks the provider total as estimated or mixed. A Terminal estimate is not a separate line there: Spend groups by provider and by category only, and a session-type line would need a new field in the usage contract, a new query group and a new row in the page.

## Open questions

1. Should estimated Terminal cost count in Analytics Spend, and as its own line? For a subscription login it is not a bill.
2. A handback prompt whose records reach neither file before its next hook event still opens a turn. Not observed; the real-agent check covers it.
3. A turn started by a sub-agent's handback or a task notification has its own prompt id. Its usage is counted only if Claude Code fires `UserPromptSubmit` for it.
4. Compaction, for both agents; Codex resume; Codex tool kinds other than `exec` and the collaboration calls; a Codex response interrupted before it finished; nested or failed sub-agents.
5. The Sonnet 5.5 card lists cache reads at $0.20 per million, which is 0.1 × its input price like the Haiku and Sonnet 5 cards. Two chat session files imply Claude Code charges $0.10 (0.05 ×, as the Opus 5.5 card states for Opus). The card was left as it is: the evidence is inference from two files, not the vendor's price page. Estimates for that model ran 2–17% above the CLI total.
6. Long-context and fast-mode prices are not modelled.

## Tests

- `native-tail.test.ts`: appended lines only, late-created file, continue from a position, partial last line, truncated file, closed watcher, failing handler.
- `claude-transcript.test.ts`, `codex-rollout.test.ts`, `turn-usage.test.ts`: parsers and the accumulator against reduced copies of the real files in `apps/server/test/fixtures/terminal-usage/` (structure, ids and numbers kept; attachments and all text removed), including the undercount, repeated ids, interrupt, resume, sub-agent files and unknown records.
- `native-hook-script.test.ts`: the generated hook script against a local listener.
- `native-terminal-steps.db.test.ts`, `native-terminal-usage.db.test.ts`: steps, tokens, cost and the session total on real runs through the authenticated hook endpoint, including a background sub-agent that finishes after Stop (real sample), resume from the stored position, and the read after Stop.
- `tests/browser/native-terminal-usage.spec.ts`: a fixture CLI for each agent that calls the real hook script and writes a session file; checks the Steps and Cost tabs, for Claude before and after exit.

No real provider turn was run with this code. Release validation needs the real-agent checks: a Claude turn with tool calls, Esc, `/exit`, Resume, a background sub-agent, `/clear`, Stop, and a Codex turn with a sub-agent.
