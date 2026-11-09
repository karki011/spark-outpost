---
title: Permissions and approvals
section: Understand Spark
type: concept
order: 512
summary: The agent's mode and Spark autonomy, why an approval card appears, what never goes on without you, and what happens when nobody answers.
---

The **agent's mode** decides what the agent may do without asking; **Spark autonomy**, what Spark does with the result. Spark adds only a few hard rails.

| Layer              | Decides                                | Details                                                                  |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| The agent's mode   | Whether edits and commands ask         | [Agent modes](modes-and-levels.md#agent-modes)                           |
| Spark autonomy     | Plans, keeping, shipping, PR follow-up | [Autonomy levels](modes-and-levels.md#autonomy-levels)                   |
| Hard rails         | What asks or is refused in every mode  | [Protected paths](protected-paths.md)                                    |
| The project's list | Commands that skip the card            | [Allowed commands](answer-approvals.md#let-a-command-run-without-asking) |

Spark, not the model, runs the checks, so no agent can approve its own request.

![An approval card showing a file diff](images/approvals-edit-light.png)

## What never goes on without you

- Approval cards, and the protected paths your [rules](protected-paths.md#spark-rules) set.
- **Address PR feedback?** at **Automatic**.
- Merging.

## Actions that ran without review

In **Bypass permissions**, **Workspace access**, **Auto review** or **Full access**, Spark watches without asking; [always refused](protected-paths.md#what-is-always-refused) actions still stop, except as [noted](protected-paths.md#what-is-always-refused) for Codex's own sandbox:

- Each tool call is marked **Ran without review** in the audit log.
- Crossing a rule you [set](protected-paths.md#spark-rules), such as pushing a branch not the chat's own, gets a flag with **Revert** and **Got it**, pinned; it never counts as needing you. With no rules, there is only the audit entry.

## Sending data out after reading secrets

After a run reads secrets (by a script too), a web page or tickets, Spark notes sends elsewhere on the mode's card or as a non-blocking flag. `localhost` and the chat's own repository and PR don't count.

Sending a secret file's value [always asks](protected-paths.md#what-always-asks).

## If you don't answer

Approval cards are declined after 30 minutes.

**This chat is almost full** follows **Wait before going on without your answer** in **Settings → Chats & autonomy**: **30s**, **60s** (default), **2 min**, **5 min**, **Never** or **Custom**. Then Spark keeps going.
