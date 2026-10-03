---
title: How approvals work
section: Understand Spark
type: concept
order: 816
summary: Why an approval card appears, what Spark adds on top of the agent's mode, and what happens when nobody answers.
---

Spark follows the agent's own mode: when the mode lets the agent act, there's no card. You see an approval card only when the mode asks you, or when a hard rail applies. The checks run in Spark, not in the model, so nothing an agent says can approve its own request.

![An approval card showing a file diff](images/approvals-edit-light.png)

| Layer              | What it decides                                                                              | Details                                               |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The agent's mode   | Whether edits and commands ask                                                               | [Agent modes](modes-and-levels.md#agent-modes)        |
| Hard rails         | What asks or is refused in every mode                                                        | [Protected paths](protected-paths.md)                 |
| The project's list | Commands that skip the card                                                                  | [Let a command run without asking](allow-commands.md) |
| Shared worktrees   | Builders working side by side in one folder go through Spark, so each stays in its own files | [How pieces work](how-pieces-work.md)                 |

To answer a card, see [Answer an approval card](answer-approvals.md).

## Actions that ran without review

In **Bypass permissions**, **Approve for me** or **Full access** the agent acts without asking. Spark doesn't stop it; it watches:

- Each such tool call is marked **Ran without review** in the audit log.
- An action that crosses a protected path gets a card in the chat, such as "Bolt wrote outside the project: ~/x.txt", with **Revert** and **Dismiss**.
- The chat shows **Flagged by Spark** in the chat list and on Spark Island until you answer.

## Sending data out after reading secrets

If a run has read sensitive data, such as a secret file you allowed, Spark asks before anything in that run sends data off your computer. The card says what was read and where the data would go. It can only be allowed once at a time.

## If you don't answer

Approval cards wait up to 30 minutes, then the request is declined.

Spark's own questions follow **If you don't answer a question** in **Settings → Spark**: **Off**, **10s** (default), **30s** or **60s**. After that time Spark picks the safe option:

| Card                                 | Spark picks                            |
| ------------------------------------ | -------------------------------------- |
| **A few questions first**            | The agent's best guesses               |
| **Build this plan?**, Full auto only | **Build**                              |
| A stuck or failing step              | **Stop and report**                    |
| **Jev could not verify the change**  | **Finish as it is**, marked unverified |
| **This chat is almost full**         | **Keep going**                         |

With **Off**, these wait for you.
