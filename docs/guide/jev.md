---
title: Jev, Spark's advisor
section: Work with Spark
order: 230
summary: What Jev decides and what it never does, how to connect it, Check changes with Jev, and what it costs.
---

You'll learn what Jev does for Spark, how to connect it, and what changes without it. About 3 minutes.

Jev is an optional advisor from TypeSafe. It answers a few short questions about each request. Code turns those answers into decisions, and the rules take over whenever Jev is unsure or missing.

## What Jev decides

| Job         | What Jev answers                                                                                                                      | Without Jev                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Intake**  | Is the request a question, too vague, a review, destructive, or part of the same task? It also picks a category, such as **Bug fix**. | The rules decide. Vague requests aren't caught and no category shows.          |
| **Routing** | Rates the request 1–5 for complexity, ambiguity, stakes and context. On **Auto**, these ratings feed Spark's model choice.            | The rules estimate the ratings. See [How Auto picks a model](auto-routing.md). |
| **Triage**  | Sorts new pull request comments into fix, question, disagreement, nit and so on.                                                      | Keyword rules sort them.                                                       |
| **Checks**  | Verifies the finished change and says which review findings need a fix. See [Check changes with Jev](#check-changes-with-jev).        | Your project's checks and the Critic decide.                                   |
| **The Map** | Labels each area of a project, such as auth or payments.                                                                              | Rules label the areas.                                                         |

Jev only counts when it's sure enough. Below its confidence line, the rules decide that question.

## What Jev never does

- It never answers a chat, edits files, calls tools or runs code.
- It never answers an approval card, loosens a mode, raises a budget or skips a safety check.
- It never picks the model itself. Its ratings go into a score that code calculates.

## Connect Jev

1. Get an API key in the **TypeSafe console** under API keys.
2. Open **Settings → AI providers** and find **Advisor**.
3. Open the **Jev** card, paste the key and verify it.

The key is stored in your system keychain. To replace it or remove Jev, open the card's **…** menu and select **Change key** or **Disconnect**.

![The Advisor section with Jev connected](images/jev-advisor-light.png)

## Check changes with Jev

**Check changes with Jev** sits under **Advisor** in **Settings → AI providers**. It's on by default and needs Jev connected. With it on, Jev also gets code diffs:

- **Proposed edits**: watched only, never blocked or allowed.
- **Final diff**: verified. If Jev finds the change incomplete, a stronger model redoes it once. If Jev can't say what's missing, your project's checks pass and the Critic has no concerns, you get the **Jev could not verify the change** card instead of a second Builder.
- **Review findings**: Jev uses the diff to tell which ones need a fix.

Turn it off to keep diffs on your computer. Jev then sees only your requests.

## What Jev reads

The **Sends** line on the connected card lists it. In short: your request, the previous request and a short task summary, and the text of files you attach. With **Check changes with Jev** on, also the diffs.

Jev never gets keys, tool output or your full chat history. TypeSafe doesn't train on it. The Map sends some file contents to label areas, but never secret files or anything in `.sparkignore`. See [Privacy and secrets](privacy-and-secrets.md).

## What it costs

TypeSafe bills Jev to your TypeSafe account, by input tokens only. A typical call costs well under $0.0001, and verifying a key is free. There's no **Send test message** for Jev, because a test would be billed.

To see what Jev cost, open a chat's **Work** panel: the totals add "Jev" with its estimated cost. **Settings → Usage** also shows Jev's own cost.

## Not connected or not asked

The why-lines under a reply and in the model picker say how Jev took part:

- **Jev not connected**: there's no Jev key, so the rules decided.
- **Not asked**, for example "pinned, no Jev call": Jev is connected, but this step didn't need it. A model you picked yourself, destructive work that always goes to the top model, and a single possible model all skip Jev.
- **Jev timed out** or **Jev failed**: Spark asked, got no answer and used the fixed rules.

> **Tip:** Hover the line under a reply to see each of Jev's calls, how sure it was and what it cost.

## When the Spark switch is off

With the **Spark** switch off in **Settings → Spark**, chats go straight to your agent and Jev isn't called. Approvals and safety rules still apply. The Map still uses Jev to label areas.

**Next:** [Ship and pull requests](ship-and-pull-requests.md)
