---
title: Open a terminal
section: Chats
type: how-to
order: 226
summary: Run commands beside a chat, or work with Claude Code or Codex in a Terminal session.
---

Open an AI terminal. About 1 minute.

## Start a Terminal session

1. Select **New chat**, then **Terminal**.
2. Pick **Claude Code** or **Codex** in the agent menu. Select **Choose project → Choose a folder…**, then **Use this folder**.
3. Pick **Agent mode** when available.
4. Describe the work and select **Start terminal**.

Answer questions in the terminal. Native commands follow the agent's permissions. Pull requests aren't automatic.

**Running**, **Waiting for input**, **Waiting for permission** and **Idle** follow agent events. **Open** means tracking is unavailable. Drop files or folders to insert paths; press Enter yourself.

Agents can read this activity with `spark_terminals`.

**Hide view** keeps the agent running; **Open terminal** reattaches. **Stop session** asks you to hold before stopping the agent and its commands. Terminal sessions are available only on your Mac.

## Open a shell beside Chat

1. Select **Terminal** in a chat header, or press **⌃\`**.
2. Type commands in your own shell; Spark doesn't ask for approval.
3. Select **+** for another tab, or **×** to close one.

![The terminal dock below a chat](images/terminals-dock-light.png)

The shell starts in the chat's worktree, chosen checkout, or home folder. Closing a busy tab asks **Hold to stop**; **Keep running** cancels.

![Hold to stop a busy terminal](images/terminals-stop-light.png)

## Close and recover

Switching chats, closing a window or disconnecting keeps agents running. **Quit** stops Spark-owned agents; outside terminals are unaffected.

After a service crash or Mac restart, **Interrupted** sessions offer **Resume session** where the provider supports it. Resume restores provider history, not an interrupted command. Nothing restarts automatically.

**Next:** [Use the browser](use-the-browser.md)
