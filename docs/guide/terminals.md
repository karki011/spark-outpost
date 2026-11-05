---
title: Open a terminal
section: Chats
type: how-to
order: 226
summary: Run commands beside a chat, or work with an agent's own CLI in a Terminal session.
---

Open an AI terminal. About 1 minute.

> **Important:** Terminal sessions follow the provider’s mode, without Spark’s approval cards or [path protection](protected-paths.md). [Recording](settings.md#record-terminal-sessions) covers Claude with Spark’s mod; Codex keeps metadata only.

## Start a Terminal session

1. Select **New chat**, then **Chat** → **Terminal** below the box.
2. Select **Choose project**, then a project or **Add folder…**.
3. Beside **Start terminal**, pick **Claude Code** or **Codex** and permissions, or an installed **Gemini CLI**, **OpenCode** or **Amp**.
4. Claude Code or Codex: describe the work; press **Enter**. Others start empty, untracked.

The lead [delegates implementation](how-spark-works.md#how-work-is-split). Pull requests aren't automatic.

**Running**, **Waiting for input**, **Waiting for permission** and **Idle** follow agent events; idle Claude shows its [cache](statuses-and-limits.md#prompt-cache). **Open**: no tracking. Drops insert paths.

Selection copies; **Add to terminal**, **Ask about this**, **Comment** and **New chat with this** reuse it (hold Option). [Browser picks](use-the-browser.md#point-at-something) land there.

**Focus terminal** (**⌘⇧F**) hides the chat list and Work panel. **⋯** has **Copy folder path**, **Reconnect** and **Stop session** (hold). [Paired devices](use-your-phone.md) can follow.

## Open a shell beside Chat

1. In a chat's **…** menu, select **Terminal**, or press **⌃\`**.
2. Type commands; Spark doesn't ask.
3. **+** adds a tab, **×** closes one.

![The terminal dock below a chat](images/terminals-dock-light.png)

It starts in the chat's worktree, checkout or home. A busy tab asks **Hold to stop**; **Keep running** cancels.

A shell's alert (OSC 9, 777 or 99) shows in the chat row's tooltip until opened, silently.

Listening ports, like **:5173**, show on the chat's row; select one to open it in the Browser pane (Mac).

![Hold to stop a busy terminal](images/terminals-stop-light.png)

## Watch an agent's command

1. On a reply's command, select **Open in terminal**.

The read-only tab stops with **Stop turn**. Claude and Z.ai output shows when it ends.

## Close and recover

Agents survive switching chats, restarts and crashes; **Quit** stops them.

After reboot or exit, **Resume session** restores history, not running commands; **Start again** resends the first message.

**Next:** [Use the browser](use-the-browser.md)
