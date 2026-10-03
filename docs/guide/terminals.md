---
title: Open a terminal
section: Chats
type: how-to
order: 226
summary: Open a terminal in the chat's worktree or project, run several, and stop a busy one safely.
---

You'll open a terminal next to a chat and stop one that's still busy. About 1 minute.

## Open one

1. Open a chat and select **Terminal** in the chat header, or press **⌃\`**.
2. Type your commands. It's your own shell, so Spark doesn't ask for approval here.
3. Select **+** (**New terminal**) for another tab, or a tab's **×** to close it.

![A chat with the terminal dock open below the message box, showing two terminal tabs](images/terminals-dock-light.png)

Press **⌃\`** again to hide the dock. Hidden terminals keep running, also when you switch chats.

| Tab name                 | Folder                                         |
| ------------------------ | ---------------------------------------------- |
| _branch_ **· worktree**  | The chat's own worktree                        |
| **my files ·** _project_ | Your own checkout                              |
| **~**                    | Your home folder, for a chat without a project |

## Stop a busy terminal

Closing a tab with a running command asks first, for example **Stop sleep 300?**.

1. Press and hold **Hold to stop** for 1.5 seconds. This stops the command and everything it started.
2. Or select **Keep running**, or press **Esc**.

![The Stop sleep 300 question with Hold to stop and Keep running](images/terminals-stop-light.png)

Terminals end when you reload the page, quit the app or delete the chat. For the limits, see [Statuses and limits](statuses-and-limits.md#limits).

Agents can see which terminals are open and what program runs in each, never what's on the screen.

**Next:** [Make a Spark](sparks.md)
