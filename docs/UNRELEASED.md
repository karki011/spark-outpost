# Unreleased changes

Changes through 0.1.0-beta.41 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- Terminal: a notify alert a shell tab prints (OSC 9, OSC 777 `notify`, or kitty's OSC 99), such as "Build done", shows on its chat's row until you open the chat. It is an update: it never counts, chimes, pushes or shows in Spark Island, and alerts from Claude Code or Codex Terminal sessions and ConEmu progress codes (`OSC 9;4`) are ignored.
