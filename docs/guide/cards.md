---
title: Cards
section: Reference
type: reference
order: 614
summary: Every card Spark or an agent can show, what it means, its buttons, and whether it waits for you.
---

Cards wait at the end of the turn and on [Spark Island](desktop-companion.md#answer-a-card). Scrolled away, the line above the message box says **Waiting for you**.

## Approval cards

These come from the agent's mode, a [protected path](protected-paths.md) or its question, never go on alone and expire after 30 minutes.

| Card                            | Means                                                          | Buttons                                                                 |
| ------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Run** _command_**?**          | A command.                                                     | **Allow**, **Always allow**, **Always allow in this project**, **Deny** |
| **Edit** _file_**?**            | A file edit.                                                   | **Allow**, **Always allow**, **Deny**                                   |
| **Change agent instructions?**  | Edits `AGENTS.md`, `CLAUDE.md` and similar.                    | **Allow once**, **Allow for this chat**, **Deny**                       |
| **Change git hooks or config?** | Edits `.git/hooks`, `.git/config` or `git config`.             | **Hold to allow once**, **Deny**                                        |
| **Force push?**                 | Rewrites remote history.                                       | **Hold to force push**, **Deny**                                        |
| **Send a secret value?**        | A push, upload or typed site text holds a secret file's value. | **Hold to allow once**, **Deny** or **Don't**                           |
| **Claude has a question**       | Asked instead of guessing. Arrows or 1–9 pick; ⏎ sends.        | **Send**, **Skip**                                                      |

Spark adds no card around a build; the agent's [plan card](plan-card.md) is an approval card.

## Around the result

Kept changes are a **Changes kept** record with **Revert**, not a card.

| Card                                                                     | Means                                                                                                                                   | Buttons                                                                | By itself?                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Address PR feedback?**                                                 | PR fixes and replies ready.                                                                                                             | **Push and reply**, **Don't**                                          | Only at **Full auto → PR**                                            |
| **This chat is almost full**                                             | Context nears its limit; auto-compaction is off.                                                                                        | **Compact now**, **Start a fresh chat with a summary**, **Keep going** | **Keep going** after [the wait time](approvals.md#if-you-dont-answer) |
| A Spark action, such as **Create this ticket** or **Change this event?** | An editable proposed action.                                                                                                            | The action's button, **Don't**                                         | See [actions](spark-tools.md#when-actions-ask-first)                  |
| A flag, such as "… wrote outside the project"                            | An action crossed a protected path, pushed another branch, sent data out, or pushed a [stacked](stacked-pull-requests.md) branch early. | **Revert**, **Got it**                                                 | No; the run continues.                                                |
| **Spark refused** _command_                                              | A [Spark rule](protected-paths.md#spark-rules) refused it.                                                                              | **Allow … and retry**, **Allow once**, **Keep refused**                | No                                                                    |
| **This turn was interrupted**                                            | Spark Outpost stopped mid-turn.                                                                                                         | **Continue from here**, **Start fresh**                                | No                                                                    |
