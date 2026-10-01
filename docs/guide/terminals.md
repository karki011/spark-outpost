---
title: Terminals
section: Work with Spark
order: 250
summary: Open a terminal in the chat's worktree or project, run several, and stop a busy one safely.
---

You'll open a terminal next to a chat, run a few, and close one that's still busy. About 1 minute.

## Open a terminal

1. Open a chat.
2. Select **Terminal** in the chat header, or press **⌃\`** (Control and the backtick key).
3. Type your commands. The terminal is your own shell, so Spark doesn't ask for approval here.

To hide the terminal, press **⌃\`** again or select **Hide terminal**. Hidden terminals keep running, and the **Terminal** button shows that one is open.

![A chat with the terminal dock open below the message box, showing two terminal tabs](images/terminals-dock-light.png)

## Where it opens

The tab name tells you which folder the terminal opened in. The full path shows at the right of the tab bar.

| Tab name                 | Folder                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| _branch_ **· worktree**  | The chat's own worktree, once Spark has made one for the chat's changes.                 |
| **my files ·** _project_ | Your own checkout: before the chat has a worktree, or when it edits your files directly. |
| **~**                    | Your home folder, for a chat without a project.                                          |

If the chat's worktree was removed, the terminal opens in the project's folder instead. If the project folder has moved, it opens in your home folder. A note in the terminal says why.

## Run more than one

1. Select **+** (**New terminal**) in the tab bar. The new tab opens in the same folder, numbered, for example **my files · acme-web (2)**.
2. Select a tab to switch to it.
3. To close a tab, select its **×**. Closing the last tab hides the terminal.

Each chat keeps its own terminals. When you switch chats, the terminals of the other chat keep running.

## Stop a busy terminal

If a command is still running when you close its tab, Spark asks first, for example **Stop sleep 300?**.

1. To stop it, press and hold **Hold to stop** for 1.5 seconds, with the mouse or **Space**. This stops the command and everything it started.
2. To leave it running, select **Keep running** or press **Esc**.

Let go early to cancel. The command keeps running.

![The Stop sleep 300 question with Hold to stop and Keep running](images/terminals-stop-light.png)

## Limits

- You can have up to 12 terminals open across all chats. To open another, close one first.
- Each terminal keeps the last 5,000 lines.
- Terminals end when you reload the page, quit the app or delete the chat.

> **Tip:** Agents can see which terminals are open and what program is running in each, but never what's on the screen. See [Spark tools for agents](spark-tools.md#what-the-tools-never-return).

**Next:** [Approvals and protected paths](approvals.md)
