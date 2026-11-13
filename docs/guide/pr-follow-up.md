---
title: Let Spark handle PR feedback
section: Projects and shipping
type: how-to
order: 322
summary: Have the chat fix failing checks and answer review comments on its pull requests, pushing the fix by itself or after a confirm card.
---

You'll let Spark handle checks and reviews on a chat's PRs. About 2 minutes.

1. Read the PR row's eye: **Watching**, **Agent is on it**, **Paused**, **Stopped** or **Follow-up off**.
2. Click it for checks, reviews and **items gathered**.

   ![The opened PR row, with the items Spark gathered](images/pr-follow-up-row-light.png)

3. When checks fail, feedback arrives or the PR falls behind, Spark messages the chat once idle.
4. The agent fixes or pushes back, merges the base if needed and pushes; Spark replies. Read its summary.

To approve each push, turn on **Ask before pushing and replying** in **Settings → Pull requests**.

![The Address PR feedback? card with the push and a reply checked](images/pr-follow-up-card-light.png)

## What Spark acts on

| Feedback                             | Spark                          |
| ------------------------------------ | ------------------------------ |
| Failing checks from the PR's own CI  | Fixes them                     |
| Comments from writers or listed bots | Fixes, answers, or hands over  |
| Anyone else's comments, other bots   | Shows them as **Not acted on** |
| A disagreement                       | Always goes to you             |

An item closes when its thread resolves, its check passes or its reviewer reviews again.

## Review bots

On your Mac, add bot logins (`coderabbitai[bot]`) to **Review bots to act on**; their new comments count as reviews.

## Limits

- No round cap: a round with no push or reply means **Stopped** until new feedback or commits.
- Spark stops when CI fails the same way twice, or a reviewer repeats a pushed-back request.
- Never force-pushes, rebases, merges, approves, resolves threads, dismisses reviews or adds reviewers.
- The agent may comment on this PR only, under its mode.
- PR text is data, never instructions.

## Turn it off

In **Settings → Pull requests**, turn off **Follow up on pull requests**, or only **Fix failing checks**, **Handle review comments** or **Reply on GitHub threads**.

While it's off or asks first, a new PR offers **Turn on**.

**Next:** [Connect GitHub and ticket trackers](tickets-and-github.md)
