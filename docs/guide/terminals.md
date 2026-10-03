---
title: Open a terminal
section: Chats
type: how-to
order: 230
summary: Open a terminal in the chat's worktree or project, run several, and stop a busy one safely.
---

You'll open a terminal next to a chat and close one that's still busy. About 1 minute.

## Open one

1. Open a chat.
2. Select **Terminal** in the chat header, or press **⌃\`**.
3. Type your commands. It's your own shell, so Spark doesn't ask for approval here.

![A chat with the terminal dock open below the message box, showing two terminal tabs](images/terminals-dock-light.png)

Press **⌃\`** again or select **Hide terminal** to hide it. Hidden terminals keep running.

The tab name says where it opened:

| Tab name                 | Folder                                         |
| ------------------------ | ---------------------------------------------- |
| _branch_ **· worktree**  | The chat's own worktree                        |
| **my files ·** _project_ | Your own checkout                              |
| **~**                    | Your home folder, for a chat without a project |

## Run more than one

1. Select **+** (**New terminal**) in the tab bar.
2. Select a tab to switch. Select its **×** to close it.

Each chat keeps its own terminals, and they keep running when you switch chats.

## Stop a busy terminal

Closing a tab with a running command asks first, for example **Stop sleep 300?**.

1. Press and hold **Hold to stop** for 1.5 seconds. This stops the command and everything it started.
2. Or select **Keep running**, or press **Esc**.

![The Stop sleep 300 question with Hold to stop and Keep running](images/terminals-stop-light.png)

Terminals end when you reload the page, quit the app or delete the chat. For the limits, see [Statuses and limits](statuses-and-limits.md#limits).

> **Tip:** Agents can see which terminals are open and what program runs in each, never what's on the screen.

**Next:** [Make a Spark](sparks.md)
