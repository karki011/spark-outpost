---
title: Open a terminal
section: Chats
type: how-to
order: 226
summary: Run commands beside a chat, or work with Claude Code or Codex in a Terminal session.
---

Open an AI terminal. About 1 minute.

> **Important:** A Terminal session runs the provider's CLI under the agent's mode. Spark's cards, [protected paths](protected-paths.md) and audit don't apply; Spark records only its start, mode and state.

## Start a Terminal session

1. Select **New chat**, then **Terminal**.
2. Pick **Claude Code** or **Codex** in the agent menu. Select **Choose project → Choose a folder…**, then **Use this folder**.
3. Pick **Agent mode** when available.
4. Describe the work and select **Start terminal**.

Answer questions in the terminal. Pull requests aren't automatic.

**Running**, **Waiting for input**, **Waiting for permission** and **Idle** follow agent events. **Open** means tracking is unavailable. Drop files or folders to insert paths; press Enter yourself.

**Hide view** keeps the agent running; **Open terminal** reattaches. **Stop session** asks you to hold before stopping the agent and its commands. Terminal sessions are Mac-only.

## Open a shell beside Chat

1. Select **Terminal** in a chat header, or press **⌃\`**.
2. Type commands; Spark doesn't ask for approval.
3. Select **+** for another tab, or **×** to close one.

![The terminal dock below a chat](images/terminals-dock-light.png)

The shell starts in the chat's worktree, checkout or home folder. Closing a busy tab asks **Hold to stop**; **Keep running** cancels.

![Hold to stop a busy terminal](images/terminals-stop-light.png)

## Close and recover

Switching chats, closing a window or disconnecting keeps agents running. **Quit** stops Spark-owned agents; outside terminals are unaffected.

After a crash, restart or agent exit, the session offers **Resume session** where supported. It restores history, not a running command. Otherwise **Start again** resends your first message, unless you stopped it.

**Next:** [Use the browser](use-the-browser.md)
