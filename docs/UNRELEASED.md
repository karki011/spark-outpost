# Unreleased changes

Changes through 0.1.0-beta.4 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- Codex runs on codex-acp 2.6.0 (Codex 0.166). A question Codex asks while it keeps working shows as a question card; Codex's next-prompt suggestion stays off, so no model call runs after a turn.
- A new Codex session is named after its chat before the first message, so Codex makes no extra model call to title it; the name shows in Codex's own session list.
