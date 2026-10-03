---
title: Permissions and autonomy
section: Understand Spark
type: concept
order: 814
summary: The two separate dials - the agent's mode and Spark autonomy - how they combine, and what never goes on without you.
---

Two settings decide how much happens without you. The **agent's mode** decides what the agent may do without asking. **Spark autonomy** decides what Spark does with the result. They don't change each other.

| Dial           | Decides                                | Whose setting                  | Change it                                             |
| -------------- | -------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| Agent's mode   | Approval cards while the agent works   | The provider's, with its names | [Change the agent's mode](agent-mode.md)              |
| Spark autonomy | Plans, keeping, shipping, PR follow-up | Spark's                        | [Choose how much Spark does alone](spark-autonomy.md) |

For every mode and level, see [Agent modes and autonomy levels](modes-and-levels.md).

## How they combine

| Mode + autonomy                             | What you see                                           |
| ------------------------------------------- | ------------------------------------------------------ |
| **Manual** + **Automatic**                  | A card for every edit and command. The most control.   |
| **Accept edits** + **Automatic**            | Edits go through; commands ask.                        |
| **Auto** + **Automatic**                    | The agent asks when it judges it should. The defaults. |
| **Bypass permissions** + **Full auto → PR** | No agent cards. Spark builds, checks and opens a PR.   |
| **Plan** + any level                        | Answers only. Nothing changes.                         |

Spark honours the mode. It adds no ask rules of its own beyond the [protected paths](protected-paths.md).

## What never goes on without you

- **Approval cards.** Unanswered, they're declined after 30 minutes.
- **Protected paths**, in every mode and at both levels.
- **The plan card at Automatic.** It waits for **Build**, even in **Auto** or **Bypass permissions**.
- **Destructive plans**, at both levels.
- **Continue past the budget?**
- **Address PR feedback?** at **Automatic**.

## What Full auto → PR may do

It pushes only the chat's own `spark/` branch and opens or updates its pull request. It never merges and never force-pushes.

An agent may push that branch and open its PR itself only when your message asks for it, the chat is at **Full auto → PR**, or its mode is **Auto**, **Bypass permissions** or **Full access**.
