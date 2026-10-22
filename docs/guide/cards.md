---
title: Cards
section: Reference
type: reference
order: 614
summary: Every card Spark or an agent can show, what it means, its buttons, and whether it waits for you.
---

Cards appear under the reply and on [Spark Island](desktop-companion.md#answer-a-card). The line above the message box says **Waiting for you** while one waits.

## Approval cards

These come from the agent's mode, a [protected path](protected-paths.md) or the agent's question. They never go on by themselves and expire after 30 minutes.

| Card                                         | Means                                                                 | Buttons                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Run a command?**                           | A command to run.                                                     | **Allow**, **Always allow**, **Always allow in this project**, **Deny** |
| **Change a file?** / **Change these files?** | A file edit.                                                          | **Allow**, **Always allow**, **Deny**                                   |
| **Change agent instructions?**               | An edit to `AGENTS.md`, `CLAUDE.md` and similar.                      | **Allow once**, **Allow for this chat**, **Deny**                       |
| **Change git hooks or config?**              | An edit to `.git/hooks`, `.git/config` or `git config`.               | **Hold to allow once**, **Deny**                                        |
| **Force push?**                              | A push that rewrites remote history.                                  | **Hold to force push**, **Deny**                                        |
| **Send a secret value?**                     | A push, upload or text typed into a site holds a secret file's value. | **Hold to allow once**, **Deny** or **Don't**                           |
| **Claude has a question**                    | The agent asks instead of guessing. Pick with 1–9; ⌘Enter sends.      | **Send**, **Skip**                                                      |

Spark asks nothing of its own before or after a build; the agent's [plan card](plan-card.md) is an approval card.

## Around the result

Kept changes show as a **Changes kept** record with **Revert**, not as a card.

| Card                                                                     | Means                                                                                                                                   | Buttons                                                                | By itself?                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Address PR feedback?**                                                 | Fixes and replies are ready for a pull request.                                                                                         | **Push and reply**, **Don't**                                          | Only at **Full auto → PR**                                            |
| **This chat is almost full**                                             | Context is near its limit and auto-compaction is off.                                                                                   | **Compact now**, **Start a fresh chat with a summary**, **Keep going** | **Keep going** after [the wait time](approvals.md#if-you-dont-answer) |
| A Spark action, such as **Create this ticket** or **Change this event?** | An agent proposes an editable action.                                                                                                   | The action's button, **Don't**                                         | See [actions](spark-tools.md#when-actions-ask-first)                  |
| A flag, such as "… wrote outside the project"                            | An action crossed a protected path, pushed another branch, sent data out, or pushed a [stacked](stacked-pull-requests.md) branch early. | **Revert**, **Got it**                                                 | No; the run goes on.                                                  |
| **Spark refused** _command_                                              | A [Spark rule](protected-paths.md#spark-rules) refused it.                                                                              | **Allow … and retry**, **Allow once**, **Keep refused**                | No                                                                    |
| **This turn was interrupted**                                            | Spark Outpost stopped mid-turn.                                                                                                         | **Continue from here**, **Start fresh**                                | No                                                                    |
