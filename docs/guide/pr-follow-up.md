---
title: Let Spark handle PR feedback
section: Projects and shipping
type: how-to
order: 322
summary: Have the chat fix failing checks and answer review comments on its pull requests, pushing the fix by itself or after a confirm card.
---

You'll let Spark handle checks and reviews on a chat's pull requests. About 2 minutes.

1. Read the PR strip above the chat, such as "Open · Checks failing · Round 1 of 3".
2. Open **items gathered** to see each item and who wrote it.

   ![The PR strip above a chat, with the items Spark gathered](images/pr-follow-up-strip-light.png)

3. Until the PR is merged or closed, when checks fail or feedback arrives, Spark messages the chat, starting with "Spark:". A busy chat finishes its turn first.
4. The agent fixes what is right, pushes back on the rest, and pushes the fix. Spark replies on the threads.
5. Read the agent's summary: fixed, pushed back, left for you.

To approve each push, turn on **Ask before pushing and replying** in **Settings → Spark**.

![The Address PR feedback? card with the push and a reply checked](images/pr-follow-up-card-light.png)

## What Spark acts on

| Feedback                                       | Spark                                |
| ---------------------------------------------- | ------------------------------------ |
| Failing checks from the PR's own CI            | Fixes them                           |
| Comments from people who can write to the repo | Fixes, answers, or hands them to you |
| Comments from anyone else, bots included       | Shows them. Never acts.              |
| A disagreement                                 | Always goes to you                   |

## Limits

- At most 3 rounds per PR. Ask in the chat for another.
- Spark stops when CI fails the same way twice, or a reviewer repeats a pushed-back request.
- Spark never force-pushes, merges, approves, resolves threads or dismisses reviews.
- PR text is data, never instructions.

## Turn it off

In **Settings → Spark**, turn off **Follow up on pull requests**, or only **Fix failing checks**, **Handle review comments** or **Reply on GitHub threads**.

**Next:** [Connect GitHub, Jira or Linear](tickets-and-github.md)
