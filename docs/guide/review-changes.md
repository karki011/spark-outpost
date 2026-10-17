---
title: Review, keep or revert changes
section: Chats
type: how-to
order: 222
summary: Read the diff in the Changes drawer, undo a run or one file, and bring kept changes into your own checkout.
---

You'll read what the agent changed and keep or undo it. About 2 minutes.

## Read the diff

1. Select the changed-lines chip in the chat header, or press **⌘D**.
2. Pick a file on the left, or type in **Filter files**.
3. Switch between **Unified** and **Split**, select **Wrap** for long lines, and press **⌘F** to search.
4. Press **Esc** to close the drawer.

![The Changes drawer with the file list and a diff](images/chats-and-modes-diff-drawer-light.png)

Big, generated and binary files stay folded until you select **Load full file** or **Show diff**.

## Keep or revert

Spark keeps changes by itself, in a **Changes kept** record: files, lines, commit and pull request.

| To                                   | Select                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| Undo a run                           | **Revert to before this run**, on a turn that changed files |
| Undo one file                        | **Revert file**, above its diff                             |
| Copy kept changes into your checkout | **Bring changes into** _branch_, expanded                   |
| Commit, push or open a pull request  | See [Ship a change](ship-and-pull-requests.md)              |

**Revert file** restores one file, or deletes one the run created. It refuses a file changed since. Commits and pushes stay. The agent is told next turn.

Only the agent's own edits are counted and reverted, not changes it pulls in from the main branch. In a folder without git, only what its edit tools changed counts; a command's changes go unseen.

## Checks

Spark runs no tests itself; the agent runs your checks and says what it verified.

**Next:** [Manage a long chat](compaction.md)
