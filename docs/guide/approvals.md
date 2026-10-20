---
title: Permissions and approvals
section: Understand Spark
type: concept
order: 512
summary: The agent's mode and Spark autonomy, why an approval card appears, what never goes on without you, and what happens when nobody answers.
---

The **agent's mode** decides what the agent may do without asking. **Spark autonomy** decides what Spark does with the result. Spark follows the mode, adding only a few hard rails.

| Layer              | Decides                                | Details                                                                                  |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| The agent's mode   | Whether edits and commands ask         | [Agent modes](modes-and-levels.md#agent-modes)                                           |
| Spark autonomy     | Plans, keeping, shipping, PR follow-up | [Autonomy levels](modes-and-levels.md#autonomy-levels)                                   |
| Hard rails         | What asks or is refused in every mode  | [Protected paths](protected-paths.md)                                                    |
| The project's list | Commands that skip the card            | [Let a command run without asking](answer-approvals.md#let-a-command-run-without-asking) |

Checks run in Spark, not the model, so nothing an agent says can approve its own request.

![An approval card showing a file diff](images/approvals-edit-light.png)

## What never goes on without you

- Approval cards, and protected paths in every mode and at both levels.
- **Address PR feedback?** at **Automatic**.
- Merging. Nothing ever merges.

## Actions that ran without review

In **Bypass permissions**, **Approve for me** or **Full access**, Spark doesn't stop the agent; it watches:

- Each such tool call is marked **Ran without review** in the audit log.
- An action that crosses a protected path, or pushes a branch that isn't the chat's own, gets a card, such as "Bolt wrote outside the project: ~/x.txt", with **Revert** and **Dismiss**.

## Sending data out after reading secrets

After a run reads secrets, a web page or tickets, Spark notes sends elsewhere: on the mode's card, or as a flag. The chat's own repository and PR don't count.

Sending a secret file's value [always asks](protected-paths.md#what-always-asks).

## If you don't answer

Approval cards wait up to 30 minutes, then are declined.

**This chat is almost full** follows **Wait before going on without your answer** in **Settings → Chats & autonomy**: **30s**, **60s** (default), **2 min**, **5 min**, **Never** or **Custom**. Then Spark keeps going.
