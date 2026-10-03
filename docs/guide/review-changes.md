---
title: Review, keep or revert changes
section: Chats
type: how-to
order: 222
summary: Read the diff in the Changes drawer, undo a run, and bring kept changes into your own checkout.
---

You'll read what the agent changed and keep or undo it. About 2 minutes.

## Read the diff

1. Select the changed-lines chip in the chat header, such as **+2,550 −21**, or press **⌘⇧D**.
2. Pick a file on the left, or type in **Filter files**.
3. Switch between **Unified** and **Split**, select **Wrap** for long lines, and press **⌘F** to search.
4. Press **Esc** to close the **Changes** drawer.

![The Changes drawer with the file list and a diff](images/chats-and-modes-diff-drawer-light.png)

Big files show 2,000 lines until you select **Load full file**. Lockfiles, generated files, binary files and files over 1 MB stay folded until you select **Show diff**.

## Keep or revert

Spark keeps changes by itself. The **Keep these changes?** card shows "Kept automatically", with a [**Worth a look**](guardrails.md#worth-a-look) list when something needs your eye.

| To                                   | Select                                         |
| ------------------------------------ | ---------------------------------------------- |
| Undo a run                           | **Revert to before this run** on the turn      |
| Copy kept changes into your checkout | **Bring changes into** _branch_                |
| Commit, push or open a pull request  | See [Ship a change](ship-and-pull-requests.md) |

The card waits for you, with **Keep**, **Fix** and **Revert**, only when Spark won't decide alone:

| Autonomy           | The card waits when                                             |
| ------------------ | --------------------------------------------------------------- |
| **Automatic**      | A risky migration was made in your own checkout, not a worktree |
| **Full auto → PR** | Checks fail and you chose **Stop and ask**                      |

Select **Fix**, type what should change, and select **Ask for a fix**.

Only the agent's own edits are counted and reverted, not changes it pulls in from the main branch.

**Next:** [Manage a long chat](compaction.md)
