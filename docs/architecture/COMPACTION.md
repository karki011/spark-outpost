# Chat compaction

Since October 1, 2026 (`apps/server/src/compaction/`, migration `0088_compactions.sql`). The chat's own resumable session (Scout or a plain chat, agent keys `chat:*`) is the one that grows; Builders start small task sessions, and coordinator pieces and Builder child runs are never compacted by this path.

## When

- Checked only between turns: before a chat turn starts (`prepareTurn` in `orchestrate`, before intake), never mid-turn, and never while any approval card in the chat is pending.
- The reading is the context the agent reported on the session's last turn (`provider_sessions.context_used` / `context_size`, written when the turn finishes). Only a session the coming turn would resume counts.
- Thresholds (`@spark-outpost/contracts` `compaction.ts`): the ring warns at 70% (`COMPACT_WARN_PERCENT`, a quiet note), compaction starts at 85% (`COMPACT_AT_PERCENT`).
- What happens at 85% follows the chat's autonomy:
  - **Review each step:** the card "This chat is almost full" (checkpoint kind `compact`) offers **Compact now**, **Start a fresh chat with a summary** and **Keep going**. Keep going sets `provider_sessions.compact_snoozed`, so the card returns at 95% (`COMPACT_SNOOZED_PERCENT`). If you don't answer, the auto-continue setting picks Keep going.
  - **Automatic / Full auto → PR:** Spark compacts before the turn and posts a step in the work log.

## How

1. **The agent's own `/compact`** when the session advertised the command (`provider_sessions.available_commands`): Spark resumes that session and sends `/compact` as its own turn through the normal slash-command path, with the same model, mode, repo config and MCP servers as the chat, so the session and its cache prefix are kept. It counts only when the agent reports usage below 80% of the reading before (`COMPACT_AGENT_WORKED`). The user's message then goes to the same session with a one-line note that the context was compacted and that `spark_chat_history` exists.
2. **Spark's summary** when the agent has no `/compact`, the turn failed, or usage didn't drop: `chatSummaryPrompt` (`orchestration/handoff.ts`, kind `chat`) builds it from the transcript in Postgres: the first request, every request (latest 30), the agreed plan, the last 12 turns verbatim (4,000 characters each), files changed and the diff against HEAD, and open issues (failing checks, open review findings). Stale tool output never enters it. The chat's sessions close with reason `compacted`; the next session starts fresh with the summary as its preamble and only the turns after the compaction as history (`RunInput.seed`).
3. **Start a fresh chat with a summary** creates a chat in the same projects with the same settings, titled "… (continued)", seeds it with the summary, sends your message there and closes the old chat's sessions. Each chat links to the other ("Continued in a fresh chat", "Started from a summary of …").

Every compaction is a row in `compactions`: chat, run, session, method (`agent`, `spark`, `agent-auto`), tokens before and after, summary, the last message it covers and, for a fresh chat, where it came from. The chat shows a divider above the turn ("Compacted · 180K → 16K tokens") with View summary.

## Agent self-compaction

Claude Code and Codex compact on their own (Z.ai via `CLAUDE_CODE_AUTO_COMPACT_WINDOW`). When the reported context of one session drops by more than 40% between consecutive turns (`COMPACT_SELF_DROP`) without Spark asking, the turn records method `agent-auto` and the chat shows "The agent compacted its context". This covers Builder task sessions too.

## Nothing is lost

The full transcript stays in `messages`. `spark_chat_history` returns any range of turns (`from`, `to`), turns matching a search, and the compaction summaries; the summary preamble and the post-`/compact` note tell the agent the tool exists.

## Testing

- Unit: `compaction/policy.test.ts` (thresholds, autonomy, drop detection), `orchestration/handoff.test.ts` (the chat summary).
- DB: `test/compaction.db.test.ts`, `test/compaction-card.db.test.ts`, `test/spark-mcp-history.db.test.ts`. The fake ACP agent reports usage when `FAKE_ACP_CONTEXT_SIZE` is set (`#ctx90` in a message sets 90%, `/compact` drops to 8%, `#selfcompact` to 10%) and advertises `/compact` through `FAKE_ACP_COMMANDS`.
- Browser: `tests/browser/compaction.spec.ts` uses the in-process fake provider: a chat containing `#ctxNN` gets a resumable session, reports NN% and advertises `/compact`; `#nocompact` leaves the command out.

### A live check

Not run as part of the suites; never against real work. Use a throwaway repo and chat:

- **Self-compaction:** start the agent with a low compaction window so it compacts itself after a few turns, for example `CLAUDE_CODE_AUTO_COMPACT_WINDOW=40000` in the environment Spark launches Claude Code with (Z.ai already sets this variable, see `agents/acp/zai.ts`). When its reported context drops, the chat should show "The agent compacted its context".
- **Spark's 85% path:** fill the context (paste or attach large files) until the ring passes 85%, then send one more message. At Automatic the work log shows "Sent /compact to the agent" and the divider; at Review each step the card asks first. Whether the adapter reports usage after `/compact` decides whether Spark keeps the agent's compaction or falls back to its own summary; record which one happened.

## Gaps

- Builder task sessions are not compacted by the threshold path: their follow-ups already escalate through the compact handoff at 100K+ (`escalation.ts`), and the adapters compact them on their own (recorded as `agent-auto`).
- The `/compact` turn's tokens are billed to the run through the session's cumulative cost where the agent reports one (Claude); agents that report only tokens don't count it.
- Attachments of the moved message are not carried into a fresh chat.
- There is no Spark action to request compaction from an agent; the user decides on the card or by the autonomy level.
