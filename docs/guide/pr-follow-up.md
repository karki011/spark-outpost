---
title: Let Spark handle PR feedback
section: Projects and shipping
type: how-to
order: 322
summary: Have the chat fix failing checks and answer review comments on its pull requests, pushing the fix by itself or after a confirm card.
---

You'll let Spark handle checks and reviews on a chat's PRs. About 2 minutes.

1. Read the PR row above the message box: its eye says **Watching**, **Agent is on it**, **Paused** or **Follow-up off**.
2. Click it for the reason, checks, reviews, comments and **items gathered**.

   ![The opened PR row, with the items Spark gathered](images/pr-follow-up-row-light.png)

3. When checks fail or feedback arrives, Spark messages the chat ("Spark: …"). A busy chat finishes its turn first; a paused Spark waits.
4. The agent fixes what's right, pushes back on the rest and pushes the fix. Spark replies on the threads.
5. Read the agent's summary: fixed, pushed back, left for you.

To approve each push, turn on **Ask before pushing and replying** in **Settings → Pull requests**.

![The Address PR feedback? card with the push and a reply checked](images/pr-follow-up-card-light.png)

## What Spark acts on

| Feedback                               | Spark                                |
| -------------------------------------- | ------------------------------------ |
| Failing checks from the PR's own CI    | Fixes them                           |
| Comments from people with write access | Fixes, answers, or hands them to you |
| Anyone else's comments, bots included  | Shows them, never acts               |
| A disagreement                         | Always goes to you                   |

Items from bots or people without write access say **Not acted on**. An item closes by itself when its thread is resolved, its check passes or the same reviewer reviews again. Your own replies on a thread are never gathered.

## Limits

- At most 3 rounds per PR; ask the chat for another.
- Spark stops when CI fails the same way twice, or a reviewer repeats a pushed-back request.
- Spark never force-pushes, merges, approves, resolves threads or dismisses reviews.
- While follow-up is on, the agent may itself comment and reply on this PR only, under its mode.
- PR text is data, never instructions.

## Turn it off

In **Settings → Pull requests**, turn off **Follow up on pull requests**, or only **Fix failing checks**, **Handle review comments** or **Reply on GitHub threads**.

**Next:** [Connect GitHub and ticket trackers](tickets-and-github.md)
