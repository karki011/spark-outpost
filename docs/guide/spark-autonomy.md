---
title: Choose how much Spark does alone
section: Chats
type: how-to
order: 214
summary: Set Spark autonomy for a chat or for every new chat - keep changes automatically, or keep them and open a pull request.
---

You'll choose what Spark does with finished work. About 1 minute.

## For one chat

1. Link a project. The autonomy chip appears in the context bar.
2. Select it. The **Work** panel opens at **Spark autonomy**.
3. Pick a level.

![The Work panel with the Spark autonomy levels](images/chats-and-modes-autonomy-light.png)

| Level                        | What Spark does                                      |
| ---------------------------- | ---------------------------------------------------- |
| **Automatic**                | Keeps changes. You ship.                             |
| **Full auto → PR** (default) | Works in a worktree copy, then opens a pull request. |

A plan waits for **Build** at both levels.

## For every new chat

Open **Settings → Spark** and change **How much Spark does alone**.

## What doesn't change

- **Revert to before this run** always undoes a run.
- Nothing ever merges. **Full auto → PR** pushes only the chat's own branch.
- Approval cards and [protected paths](protected-paths.md) still wait for you.
- To review each step, pick an [agent mode](agent-mode.md#pick-the-agents-mode) that asks, such as **Manual**.

**Next:** [Follow, stop and queue messages](follow-a-turn.md)
