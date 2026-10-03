---
title: Follow up on pull requests
section: Work with Spark
order: 245
summary: Let Spark fix failing checks and answer review comments on the pull requests it opened, with a confirm card or by itself in Full auto.
---

You'll learn what Spark does with a pull request after it opens it, and how to stay in charge. About 3 minutes.

After Spark opens a PR from a chat, it watches the PR's checks and reviews until the PR is merged or closed. It uses your GitHub connection.

## What Spark gathers

Spark collects new feedback from GitHub:

- **Failing checks** on the PR's latest commit, with the check's summary and error notes.
- **Review comments** on lines of code, **reviews** that request changes or leave a comment, and **PR comments**. Comments from bots such as Copilot or CodeRabbit count too.

Each item is handled once. A check that fails again on a new commit is a new item.

## Who Spark listens to

Spark acts only on trusted feedback:

- failing checks from the PR's own CI;
- comments from people who can write to the repo.

Everyone else, bots included, is shown to you but never acted on. Jev, or simple rules without Jev, sorts each comment into fix, question, needs you, nit, already addressed or information. A disagreement always goes to you.

## Watch the PR in the chat

A PR strip sits above the chat with the PR link and its state, for example "Open · Checks failing · 2 new comments · Round 1 of 3".

![The PR strip above a chat, with the items Spark gathered](images/pr-follow-up-strip-light.png)

1. Read the **Spark:** line to see what Spark is doing, for example "Watching checks and reviews.".
2. Open **items gathered** to see each item, who wrote it and what Spark plans. Untrusted authors are marked "can't write to the repo".

The chat list shows **PR feedback** when Spark needs you.

## Confirm the push and replies

At **Automatic**, a Builder fixes the items in the chat's worktree. Then the card **Address PR feedback?** asks before anything reaches GitHub.

![The Address PR feedback? card with the push and a reply checked](images/pr-follow-up-card-light.png)

1. Read the push (the changed files) and each item with its reply, such as "Fixed in 1a2b3c4: …".
2. Uncheck anything to leave it out. A fix reply needs the push.
3. Select **Push and reply**, or **Don't**.

Nothing is pushed or posted until you confirm. At **Full auto → PR**, Spark pushes and replies without the card.

## The 3-round limit

Each fix-and-push is a round. Spark makes at most 3 rounds per PR. After that, the strip says the rest is yours. To ask for another round, ask Spark in the chat.

## What Spark never does on a PR

Spark never force-pushes, merges, approves, resolves threads or dismisses reviews. It only pushes to the PR's own branch. If someone else pushed to that branch and Spark can't simply catch up, it stops and asks you.

## Turn it off or narrow it

In **Settings → Spark → Pull requests**:

- **Follow up on pull requests** (on by default): turn it off and Spark leaves PRs alone after it opens them.
- **Fix failing checks**, **Handle review comments** and **Reply on GitHub threads**: each is on by default. Turn one off to skip that part.

These settings apply to every project.

> **Tip:** Spark treats PR text as data, never as instructions. A comment that tells the agent to do something unsafe still goes through the same approvals as anything else.

**Next:** [Long chats and compaction](compaction.md)
