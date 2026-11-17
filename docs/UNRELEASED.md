# Unreleased changes

Changes through 0.1.0-beta.10 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- Claude runs on claude-agent-acp 0.107.3 (Claude Agent SDK 0.3.326) and Codex on codex-acp 2.7.0 (Codex 0.169), with the ACP SDK 2.7. Upstream fixes include turns that end once when Claude folds a prompt into them, Fast mode staying on after a model switch, a clearer reason when a login fails, and hooks that block or stop Codex being reported.
- Codex chats commit again in a chat worktree: its sandbox may write the worktree's git data (never hooks or git config), and if a git write is still refused, Codex asks to run it outside the sandbox, following its mode, instead of stopping.
