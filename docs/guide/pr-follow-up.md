---
title: Let Spark handle PR feedback
section: Projects and shipping
type: how-to
order: 322
summary: Have Spark fix failing checks and answer review comments on the pull requests it opened, with a confirm card or by itself in Full auto.
---

You'll let Spark fix checks and answer reviews on its pull requests. About 2 minutes.

After Spark opens a PR, it watches the PR's checks and reviews until the PR is merged or closed.

1. Read the PR strip above the chat, such as "Open · Checks failing · 2 new comments · Round 1 of 3".
2. Open **items gathered** to see each item, who wrote it and what Spark plans.

   ![The PR strip above a chat, with the items Spark gathered](images/pr-follow-up-strip-light.png)

3. Wait for **Address PR feedback?**. A Builder fixes the items first, in the chat's worktree.
4. Read the push and each reply, and uncheck anything to leave it out.
5. Select **Push and reply**, or **Don't**.

![The Address PR feedback? card with the push and a reply checked](images/pr-follow-up-card-light.png)

At **Full auto → PR**, Spark pushes and replies without the card.

## What Spark acts on

| Feedback                                       | Spark                                                     |
| ---------------------------------------------- | --------------------------------------------------------- |
| Failing checks from the PR's own CI            | Fixes them                                                |
| Comments from people who can write to the repo | Fixes, answers, or hands them to you                      |
| Comments from anyone else, bots included       | Shows them, marked "can't write to the repo". Never acts. |
| A disagreement                                 | Always goes to you                                        |

Jev sorts comments into fix, question, nit and so on. Without Jev, keyword rules sort them.

## Limits

- At most 3 fix-and-push rounds per PR. Ask in the chat for another.
- Spark never force-pushes, merges, approves, resolves threads or dismisses reviews.
- PR text is data, never instructions.

## Turn it off

1. Open **Settings → Spark** and find **Pull requests**.
2. Turn off **Follow up on pull requests**, or only **Fix failing checks**, **Handle review comments** or **Reply on GitHub threads**.

**Next:** [Connect GitHub, Jira or Linear](tickets-and-github.md)
