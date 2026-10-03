---
title: Cards
section: Reference
type: reference
order: 914
summary: Every card Spark or an agent can show, what it means, its buttons, and whether it waits for you.
---

Cards appear in the chat and on [Spark Island](companion-approvals.md). The line above the message box says **Waiting for you** while one waits.

## Approval cards

These come from the agent's mode or a [protected path](protected-paths.md). They never go on by themselves and expire after 30 minutes.

| Card                                         | Means                                                   | Buttons                                                                 |
| -------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Run a command?**                           | The agent wants to run a command.                       | **Allow**, **Always allow**, **Always allow in this project**, **Deny** |
| **Change a file?** / **Change these files?** | The agent wants to edit.                                | **Allow**, **Always allow**, **Deny**                                   |
| **Change agent instructions?**               | An edit to `AGENTS.md`, `CLAUDE.md` and similar.        | **Allow once**, **Allow for this chat**, **Deny**                       |
| **Change git hooks or config?**              | An edit to `.git/hooks`, `.git/config` or `git config`. | **Hold to allow once**, **Deny**                                        |
| **Force push?**                              | A push that rewrites history on the remote.             | **Hold to force push**, **Deny**                                        |
| Sending data out                             | This run read secrets and now wants to send data out.   | Allow once, deny                                                        |

## While Spark works

| Card                                                            | Means                                                  | Buttons                                              | By itself?                            |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| **A few questions first**                                       | The request is vague. The agent asks 1 to 3 questions. | Answer, go with its best guesses, **Stop**           | Guesses after the wait time           |
| **Build this plan?**                                            | A plan to review before anything changes.              | **Build**, **Edit**, **Stop**                        | Only at **Full auto → PR**            |
| **Continue past the budget?**                                   | A Builder used up its budget.                          | **Continue**, **Stop**                               | No                                    |
| **Jev could not verify the change**                             | Jev can't say what's missing, and checks pass.         | **Finish as it is**, **Retry one tier up**, **Stop** | Finishes after the wait time          |
| A step needs another try, or a Builder was repeating itself     | A step failed or looped.                               | **Retry**, **Stop**                                  | Stops and reports after the wait time |
| A copy and your files collided: "Which version should be kept?" | A worktree copy couldn't merge.                        | Keep one version or the other, **Stop**              | No                                    |

## Around the result

| Card                                             | Means                                                                                                     | Buttons                                                                | By itself?                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Keep these changes?**                          | Usually shown already answered, "Kept automatically". It waits only when Spark won't keep a change alone. | **Keep**, **Fix**, **Revert**                                          | Yes, except a risky migration in your checkout or failing checks with **Stop and ask** |
| **One PR or separate PRs?**                      | Pieces were built in their own copies.                                                                    | **One PR**, **Separate PRs**, and "always" for each                    | **One PR** after the wait time                                                         |
| **Address PR feedback?**                         | Fixes and replies are ready for a pull request.                                                           | **Push and reply**, **Don't**                                          | Only at **Full auto → PR**                                                             |
| **This chat is almost full**                     | The context is near its limit and auto-compaction is off.                                                 | **Compact now**, **Start a fresh chat with a summary**, **Keep going** | **Keep going** after the wait time                                                     |
| A Spark action, such as **Create this ticket**   | An agent proposes an action. You can edit the fields.                                                     | The action's button, **Don't**                                         | See [actions](spark-tools.md#when-actions-ask-first)                                   |
| A flag, such as "Bolt wrote outside the project" | An unreviewed action crossed a protected path.                                                            | **Revert**, **Dismiss**                                                | No. It doesn't block the run.                                                          |

"The wait time" is **If you don't answer a question**. See [If you don't answer](approvals.md#if-you-dont-answer).
