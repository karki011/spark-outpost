# Chat compaction

Since October 1, 2026 (`apps/server/src/compaction/`, migration `0088_compactions.sql`). The chat's own resumable session (agent keys `chat:*`) is the one that grows, and the only one a chat has since Spark's own harness was removed ([SIMPLE_ORCHESTRATION.md](SIMPLE_ORCHESTRATION.md)).

## When

- Checked only between turns: before a chat turn starts (`prepareTurn` in the chat turn), never mid-turn, and never while any approval card in the chat is pending.
- The reading is the context the agent reported on the session's last turn (`provider_sessions.context_used` / `context_size`, written when the turn finishes). Only a session the coming turn would resume counts.
- Thresholds are settings (Settings → Spark → Context compaction, `profiles.compact_warn_percent`, `compact_at_percent`, `auto_compact`, migration `0090_compaction_settings.sql`), read by `compactionThresholds` before each turn:
  - **Warn when context is** (default 60%, range 30–90): the ring turns amber and shows a quiet note.
  - **Compact automatically at** (default 80%, range 40–95): compaction starts here. The warning must be at least 5 points below it. The server (`compactionThresholdError` in `@spark-outpost/contracts` `compaction.ts`, a 400 with the message) and the database both reject other values; the settings rows show the same message inline.
  - Rows saved before the settings existed get the defaults.
- What happens at the compaction point follows the chat's autonomy:
  - **Review each step:** the card "This chat is almost full" (checkpoint kind `compact`) offers **Compact now**, **Start a fresh chat with a summary** and **Keep going**. Keep going sets `provider_sessions.compact_snoozed`, so the card returns at the compaction point plus 10, at most 95% (`reaskPercent`; 90% with the defaults). The card carries that point (`askAgainAt`) for its result line. If you don't answer, the auto-continue setting picks Keep going.
  - **Automatic / Full auto → PR:** Spark compacts before the turn and posts a step in the work log.
  - **Automatic compaction off:** every autonomy level gets the card instead; Spark only warns and asks, never compacts by itself.
- `spark_settings` returns the values as `contextCompaction`.

## How

1. **The agent's own `/compact`** when the session advertised the command (`provider_sessions.available_commands`): Spark resumes that session and sends `/compact` as its own turn through the normal slash-command path, with the same model, mode, repo config and MCP servers as the chat, so the session and its cache prefix are kept. It counts only when the agent reports usage below 80% of the reading before (`COMPACT_AGENT_WORKED`). The user's message then goes to the same session with a one-line note that the context was compacted and that `spark_chat_history` exists.
2. **Spark's summary** when the agent has no `/compact`, the turn failed, or usage didn't drop: `chatSummaryPrompt` (`workflow/session-brief.ts`, kind `chat`) builds it from the transcript in Postgres: the first request, every request (latest 30), the agreed plan, the last 12 turns verbatim (4,000 characters each), files changed and the diff against HEAD, and open issues (failing checks, open review findings). Stale tool output never enters it. The chat's sessions close with reason `compacted`; the next session starts fresh with the summary as its preamble and only the turns after the compaction as history (`RunInput.seed`).
3. **Start a fresh chat with a summary** creates a chat in the same projects with the same settings, titled "… (continued)", seeds it with the summary, sends your message there and closes the old chat's sessions. Each chat links to the other ("Continued in a fresh chat", "Started from a summary of …").

Every compaction is a row in `compactions`: chat, run, session, method (`agent`, `spark`, `agent-auto`), tokens before and after, summary, the last message it covers and, for a fresh chat, where it came from. The chat shows a divider above the turn ("Compacted · 180K → 16K tokens") with View summary. For `agent` and `spark` rows the "after" value is the context the next reply reports (system prompt and tools included), written when that reply ends (`settleTokensAfter`); until then the divider shows only the tokens before. The agent's own `/compact` reply size, which leaves out the system prompt and tools, only appears in the work-log step ("Compacted the chat: 180K tokens → a ~2K summary; the size with the system prompt and tools shows after the next reply"; since October 1, 2026).

## Agent self-compaction

Claude Code and Codex compact on their own (Z.ai via `CLAUDE_CODE_AUTO_COMPACT_WINDOW`). When the reported context of one session drops by more than 40% between consecutive turns (`COMPACT_SELF_DROP`) without Spark asking, the turn records method `agent-auto` and the chat shows "The agent compacted its context". This covers Builder task sessions too.

## Nothing is lost

The full transcript stays in `messages`. `spark_chat_history` returns any range of turns (`from`, `to`), turns matching a search, and the compaction summaries; the summary preamble and the post-`/compact` note tell the agent the tool exists.

## Testing

- Unit: `contracts/compaction.test.ts` (validation, ring levels, the re-ask point), `compaction/policy.test.ts` (thresholds, autonomy, off, drop detection), `workflow/session-brief.test.ts` (the chat summary).
- DB: `test/compaction.db.test.ts`, `test/compaction-card.db.test.ts`, `test/compaction-settings.db.test.ts` (custom thresholds, off, validation), `test/spark-mcp-history.db.test.ts`. The fake ACP agent reports usage when `FAKE_ACP_CONTEXT_SIZE` is set (`#ctx90` in a message sets 90%, `/compact` drops to 8%, `#selfcompact` to 10%) and advertises `/compact` through `FAKE_ACP_COMMANDS`.
- Browser: `tests/browser/compaction.spec.ts` uses the in-process fake provider: a chat containing `#ctxNN` gets a resumable session, reports NN% and advertises `/compact`; `#nocompact` leaves the command out. `tests/browser/settings.spec.ts` changes the thresholds.

### A live check

Not run as part of the suites; never against real work. Use a throwaway repo and chat:

- **Self-compaction:** start the agent with a low compaction window so it compacts itself after a few turns, for example `CLAUDE_CODE_AUTO_COMPACT_WINDOW=40000` in the environment Spark launches Claude Code with (Z.ai already sets this variable, see `agents/acp/zai.ts`). When its reported context drops, the chat should show "The agent compacted its context".
- **Spark's compaction path:** fill the context (paste or attach large files) until the ring passes the compaction point (80% by default), then send one more message. At Automatic the work log shows "Sent /compact to the agent" and the divider; at Review each step the card asks first. Whether the adapter reports usage after `/compact` decides whether Spark keeps the agent's compaction or falls back to its own summary; record which one happened.

## Gaps

- The `/compact` turn's tokens are billed to the run through the session's cumulative cost where the agent reports one (Claude); agents that report only tokens don't count it.
- Attachments of the moved message are not carried into a fresh chat.
- There is no Spark action to request compaction from an agent; the user decides on the card or by the autonomy level.
