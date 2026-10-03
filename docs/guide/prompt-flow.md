---
title: What happens when you send a message
section: Understand Spark
type: concept
order: 812
summary: The path a request takes from the message box to a pull request, where each card can appear, and what changes without Jev.
---

Spark reads your request, picks the smallest crew, checks the result itself and keeps it. Most requests skip most steps: a question stops after step 1, and a small fix has no plan and no Critic.

| Step            | What happens                                                                                                      | Without Jev                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1. Read         | Spark sorts the request into a kind, shown as a chip such as **Bug fix**. Questions get an answer and stop here.  | Rules read the wording.        |
| 2. Plan         | Big, destructive or "plan this" requests get [**Build this plan?**](plan-card.md).                                | Same                           |
| 3. Pick a model | A pinned model stays; on **Auto** Spark [picks per request](model-routing.md).                                    | Rules estimate the ratings.    |
| 4. Build        | A Builder makes the change in the chat's worktree, within a budget. Big plans go [in pieces](how-pieces-work.md). | Rules decide whether to split. |
| 5. Check        | Spark runs your tests and lint itself. The Builder gets up to 2 turns to fix failures.                            | Same                           |
| 6. Verify       | With **Check changes with Jev** on, Jev checks the diff. An incomplete change is redone once.                     | Skipped                        |
| 7. Review       | A Critic reviews bigger or riskier changes. A Builder fixes its findings, up to 3 rounds.                         | Same                           |
| 8. Keep         | Spark keeps the change. Concerns become a note on the reply. You can revert.                                      | Same                           |
| 9. Ship         | You [ship](ship-and-pull-requests.md), or **Full auto → PR** opens the PR.                                        | Same                           |
| 10. Follow up   | Spark [handles PR feedback](pr-follow-up.md).                                                                     | Rules sort comments.           |

![A crew turn: the dispatch line, the Builder and the kept card](images/prompt-flow-crew-turn-light.png)

## Where you can be asked

| Step | Card                          | Automatic            | Full auto → PR            |
| ---- | ----------------------------- | -------------------- | ------------------------- |
| 1    | **A few questions first**     | Waits, then guesses  | Guesses after a countdown |
| 2    | **Build this plan?**          | Waits for you        | Builds after a countdown  |
| 2    | A destructive plan            | Waits for you        | Waits for you             |
| 4    | Approval cards                | Per the agent's mode | Per the agent's mode      |
| 4    | **Continue past the budget?** | Waits for you        | Waits for you             |
| 10   | **Address PR feedback?**      | Waits for you        | Not shown                 |

"Waits, then" follows [If you don't answer](approvals.md#if-you-dont-answer). For every card, see [Cards](cards.md).

Hover the line above the crew, such as "Build it · 87% sure", to see how Spark handled each step.
