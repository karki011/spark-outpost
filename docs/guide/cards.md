---
title: Cards
section: Reference
type: reference
order: 614
summary: Every card Spark or an agent can show, what it means, its buttons, and whether it waits for you.
---

Cards appear in the chat, under the reply, and on [Spark Island](desktop-companion.md#answer-a-card). The line above the message box says **Waiting for you** while one waits.

## Approval cards

These come from the agent's mode or a [protected path](protected-paths.md). They never go on by themselves and expire after 30 minutes.

| Card                                         | Means                                                   | Buttons                                                                 |
| -------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Run a command?**                           | The agent wants to run a command.                       | **Allow**, **Always allow**, **Always allow in this project**, **Deny** |
| **Change a file?** / **Change these files?** | The agent wants to edit.                                | **Allow**, **Always allow**, **Deny**                                   |
| **Change agent instructions?**               | An edit to `AGENTS.md`, `CLAUDE.md` and similar.        | **Allow once**, **Allow for this chat**, **Deny**                       |
| **Change git hooks or config?**              | An edit to `.git/hooks`, `.git/config` or `git config`. | **Hold to allow once**, **Deny**                                        |
| **Force push?**                              | A push that rewrites history on the remote.             | **Hold to force push**, **Deny**                                        |
| **Send a secret value?**                     | A push or upload holds a secret file's value.           | **Hold to allow once**, **Deny**                                        |

## While Spark works

"The wait time" is [**Wait before going with best guesses**](approvals.md#if-you-dont-answer). Typing in a card stops its countdown.

| Card                                | Means                                          | Buttons                                                          | By itself?                            |
| ----------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| **A few questions first**           | The request is vague.                          | Pick any answers or type one, go with its best guesses, **Stop** | Guesses after the wait time           |
| **Build this plan?**                | A plan to review before anything changes.      | **Build**, **Edit**, **Stop**                                    | No                                    |
| **Jev could not verify the change** | Jev can't say what's missing, and checks pass. | **Finish as it is**, **Retry one tier up**, **Stop**             | Finishes after the wait time          |
| A step needs another try            | A step failed or looped.                       | **Retry**, **Stop**                                              | Stops and reports after the wait time |
| "Which version should be kept?"     | A worktree copy couldn't merge.                | Keep one version or the other, **Stop**                          | No                                    |

## Around the result

| Card                                             | Means                                                 | Buttons                                                                | By itself?                                                   |
| ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Keep these changes?**                          | Usually shown answered, "Kept automatically".         | **Keep**, **Fix**, **Revert**                                          | Yes, with [two exceptions](review-changes.md#keep-or-revert) |
| **One PR or separate PRs?**                      | Pieces were built in their own copies.                | **One PR**, **Separate PRs**, and "always" for each                    | **One PR** after the wait time                               |
| **Address PR feedback?**                         | Fixes and replies are ready for a pull request.       | **Push and reply**, **Don't**                                          | Only at **Full auto → PR**                                   |
| **This chat is almost full**                     | Context is near its limit and auto-compaction is off. | **Compact now**, **Start a fresh chat with a summary**, **Keep going** | **Keep going** after the wait time                           |
| A Spark action, such as **Create this ticket**   | An agent proposes an action. You can edit it.         | The action's button, **Don't**                                         | See [actions](spark-tools.md#when-actions-ask-first)         |
| A flag, such as "Bolt wrote outside the project" | An action crossed a protected path or sent data out.  | **Revert**, **Dismiss**                                                | No; the run goes on.                                         |
| **This turn was interrupted**                    | Spark Outpost stopped mid-turn.                       | **Continue from here**, **Start fresh**                                | No                                                           |
