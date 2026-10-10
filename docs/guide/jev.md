---
title: Jev, the optional advisor
section: Understand Spark
type: concept
order: 518
summary: What Jev decides and never does, what it reads, what it costs, and what happens without it.
---

Jev is an optional advisor from TypeSafe. It answers short questions outside your chats, and Spark's rules take over whenever Jev is unsure or not connected. Jev is never asked during a turn.

## What Jev decides

| Job              | With Jev                                     | Without Jev              |
| ---------------- | -------------------------------------------- | ------------------------ |
| **The Map**      | Labels each area.                            | Rules label the areas.   |
| **PR feedback**  | Sorts pull request comments.                 | Keyword rules sort them. |
| **Spark Island** | Picks what a chat's short update should say. | Rules write the update.  |

Jev never answers a chat, edits files, runs code, answers an approval card, loosens a mode, picks a model or checks a change. To add it, see [Connect Jev](providers-and-models.md#connect-jev).

![Settings on Jev's screen](images/jev-advisor-light.png)

## What Jev reads

| Sent                                                                               | Never sent                      |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| Pull request comments and check names, for [PR feedback](pr-follow-up.md)          | Keys and tokens                 |
| Short facts about a chat's latest turn, for its island update                      | Tool output                     |
| Some file contents for the Map. See [what Jev reads there](map.md#what-jev-reads). | Your full chat history          |
|                                                                                    | Secret and `.sparkignore` files |

Everything is redacted first. TypeSafe doesn't train on it. Your requests and diffs are no longer sent.

## What it costs

TypeSafe bills your account by input tokens, well under $0.0001 a call. **Settings → Usage** shows the cost.
