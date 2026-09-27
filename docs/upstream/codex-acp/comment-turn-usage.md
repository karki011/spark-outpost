<!-- FINAL DRAFT comment for the user to review and post from their own account. Not posted. Target: https://github.com/agentclientprotocol/codex-acp/issues/447. No new issue or PR: #353, #367 and #486 already implement the fix. Rechecked September 27, 2026: main (bf37821) still reports buildPromptUsage(sessionState.lastTokenUsage) on every PromptResponse path, and #447, #353, #367 and #486 are all still open. POSTING_PLAN.md posts only the text between the BODY markers. -->

<!-- BODY BELOW -->

One more client affected. It's still the case on `main` after the 1.13.2 previews: every `PromptResponse` path calls `buildPromptUsage(sessionState.lastTokenUsage)`.

We estimate cost per run from `PromptResponse.usage`, so tool-heavy Codex turns come out too low. Until this lands, we carry a local patch that does what #353, #367 and #486 do: sum the per-request change in `tokenUsage.total` over the turn (repeated updates add nothing, and it falls back to `last` when no earlier total has been seen), and reset at turn start. `usage_update.used` stays on `last`, as the context proxy.

For whoever reviews: of the three open PRs, #486 looks the most complete to us. It handles resume and load baselines, replayed or out-of-turn notifications, counter resets and synthetic context-full totals. We'd adopt it as is. Per-turn semantics match the maintainers' comment linked from agentclientprotocol/claude-agent-acp#390, and agent-client-protocol#2061 would remove the conflicting "across session" wording. A maintainer decision on any one of the three would unblock several clients here.
<!-- END BODY -->
