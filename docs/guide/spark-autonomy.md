---
title: Choose how much Spark does alone
section: Chats
type: how-to
order: 214
summary: Set Spark autonomy for a chat or for every new chat - keep changes automatically, or keep them and open a pull request.
---

You'll choose what Spark does with finished work. About 1 minute.

## For one chat

1. Link a project. The autonomy chip, a shield with the level name, appears in the context bar.
2. Select the chip. The **Work** panel opens at **Spark autonomy**.
3. Pick a level.

![The Work panel with the Spark autonomy levels](images/chats-and-modes-autonomy-light.png)

| Level                   | What Spark does                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Automatic** (default) | Keeps changes without stopping. A plan waits for **Build**. You ship when you're ready. |
| **Full auto → PR**      | Works in a worktree copy. A plan builds after a countdown. Spark opens a pull request.  |

## For every new chat

1. Open **Settings → Spark**.
2. Change **How much Spark does alone**.

## What doesn't change

- **Revert to before this run** always undoes a run.
- Nothing ever merges. **Full auto → PR** pushes only the chat's own branch.
- Approval cards and [protected paths](protected-paths.md) still wait for you at both levels.
- To review each step, pick an [agent mode](agent-mode.md#pick-the-agents-mode) that asks, such as **Manual**.

**Next:** [Follow, stop and queue messages](follow-a-turn.md)
