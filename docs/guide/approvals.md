---
title: Permissions and approvals
section: Understand Spark
type: concept
order: 512
summary: The agent's mode and Spark autonomy, why an approval card appears, what never goes on without you, and what happens when nobody answers.
---

The **agent's mode** decides what the agent may do without asking. **Spark autonomy** decides what Spark does with the result. Spark follows the mode and adds only a few hard rails.

| Layer              | Decides                                | Details                                                                                  |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| The agent's mode   | Whether edits and commands ask         | [Agent modes](modes-and-levels.md#agent-modes)                                           |
| Spark autonomy     | Plans, keeping, shipping, PR follow-up | [Autonomy levels](modes-and-levels.md#autonomy-levels)                                   |
| Hard rails         | What asks or is refused in every mode  | [Protected paths](protected-paths.md)                                                    |
| The project's list | Commands that skip the card            | [Let a command run without asking](answer-approvals.md#let-a-command-run-without-asking) |

The checks run in Spark, not in the model, so nothing an agent says can approve its own request.

![An approval card showing a file diff](images/approvals-edit-light.png)

## What never goes on without you

- Approval cards, and protected paths in every mode and at both levels.
- The plan card at **Automatic**, even in **Auto** or **Bypass permissions**.
- Destructive plans and **Continue past the budget?**, at both levels.
- **Address PR feedback?** at **Automatic**.
- Merging. Nothing ever merges.

## Actions that ran without review

In **Bypass permissions**, **Approve for me** or **Full access**, Spark doesn't stop the agent; it watches:

- Each such tool call is marked **Ran without review** in the audit log.
- An action that crosses a protected path gets a card, such as "Bolt wrote outside the project: ~/x.txt", with **Revert** and **Dismiss**.
- The chat shows **Flagged by Spark** in the chat list and on Spark Island until you answer.

## Sending data out after reading secrets

If a run has read sensitive data, such as a secret file you allowed, Spark asks before anything in that run sends data off your computer.

## If you don't answer

Approval cards wait up to 30 minutes, then the request is declined.

Spark's own questions follow **If you don't answer a question** in **Settings → Spark**: **Off**, **10s** (default), **30s** or **60s**. Then Spark picks the safe option listed in [Cards](cards.md).
