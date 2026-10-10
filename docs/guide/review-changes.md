---
title: Review, keep or revert changes
section: Chats
type: how-to
order: 222
summary: Read the diff in the Changes drawer, undo a run, and bring kept changes into your own checkout.
---

You'll read what the agent changed and keep or undo it. About 2 minutes.

## Read the diff

1. Select the changed-lines chip in the chat header, or press **⌘D**.
2. Pick a file on the left, or type in **Filter files**.
3. Switch between **Unified** and **Split**, select **Wrap** for long lines, and press **⌘F** to search.
4. Press **Esc** to close the **Changes** drawer.

![The Changes drawer with the file list and a diff](images/chats-and-modes-diff-drawer-light.png)

Big, generated and binary files stay folded until you select **Load full file** or **Show diff**.

## Keep or revert

Spark keeps changes by itself. The turn ends in a **Changes kept** record that needs no answer: files, lines, commit and pull request. Expand it for files and branch.

| To                                   | Select                                         |
| ------------------------------------ | ---------------------------------------------- |
| Undo a run                           | **Revert to before this run** on the turn      |
| Copy kept changes into your checkout | **Bring changes into** _branch_, expanded      |
| Commit, push or open a pull request  | See [Ship a change](ship-and-pull-requests.md) |

No card asks whether to keep a change. To change it, say what should change in your next message.

Only the agent's own edits are counted and reverted, not changes it pulls in from the main branch.

## Checks

Spark runs no tests or lint itself. The agent runs your project's checks and says in its reply what it verified and what it skipped. Ask it to run a command if it didn't.

**Next:** [Manage a long chat](compaction.md)
