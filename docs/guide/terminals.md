---
title: Open a terminal
section: Chats
type: how-to
order: 226
summary: Run commands beside a chat, or work with Claude Code or Codex in a Terminal session.
---

Open an AI terminal. About 1 minute.

> **Important:** A Terminal session runs the provider's CLI under the agent's mode. Spark's cards, [protected paths](protected-paths.md) and audit don't apply. Spark records state, tool names and times, tokens and estimated cost, never commands or replies: Work panel **Steps** and **Cost**.

## Start a Terminal session

1. Select **New chat**, then **Terminal** above the message box.
2. Select **Choose project → Choose a folder…**, then **Use this folder**.
3. Next to **Start terminal**, pick **Claude Code** or **Codex** and permissions.
4. Describe the work; press **Enter**.

Answer questions there. Pull requests aren't automatic.

**Running**, **Waiting for input**, **Waiting for permission** and **Idle** follow agent events. Esc before Claude replies stays **Running** until you send. **Open**: no tracking. Dropped files insert paths.

Selected text is copied, with **Add to terminal**, **Ask about this**, **Comment** and **New chat with this**. You press Enter. Hold Option to select when the agent uses the mouse.

**Focus terminal** (**⌘⇧F**) hides the chat list and Work panel. **⋯** has **Copy folder path**, **Reconnect** and **Stop session** (hold). Terminal sessions are Mac-only.

## Open a shell beside Chat

1. In a chat's **…** menu, select **Terminal**, or press **⌃\`**.
2. Type commands; Spark doesn't ask.
3. Select **+** for another tab, **×** to close one.

![The terminal dock below a chat](images/terminals-dock-light.png)

The shell starts in the chat's worktree, checkout or home. Closing a busy tab asks **Hold to stop**; **Keep running** cancels.

![Hold to stop a busy terminal](images/terminals-stop-light.png)

## Watch an agent's command

1. On a command in a reply, select **Open in terminal**.

The read-only tab is named **Claude · pnpm dev**. **Stop turn** stops the turn. Claude and Z.ai output shows when it ends.

## Close and recover

Switching chats, closing a window or disconnecting keeps agents running. **Quit** stops Spark-owned agents only.

After a crash, restart or exit, **Resume session** restores history, not a running command; else **Start again** resends your first message unless stopped.

**Next:** [Use the browser](use-the-browser.md)
