---
title: Jev, the optional advisor
section: Understand Spark
type: concept
order: 824
summary: What Jev decides and never does, what it reads, what it costs, and what happens without it.
---

Jev is an optional advisor from TypeSafe. It answers a few short questions about each request; code turns the answers into decisions, and Spark's rules take over whenever Jev is unsure or not connected.

## What Jev decides

| Job         | With Jev                                                                   | Without Jev                                  |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| **Intake**  | Names the kind of request and whether it's vague or destructive.           | Rules decide from the wording.               |
| **Routing** | Rates the request 1–5 on four scales for [model choice](model-routing.md). | Rules estimate the ratings.                  |
| **Pieces**  | Picks how many Builders a plan needs.                                      | Rules decide whether to split.               |
| **Checks**  | Verifies the finished change and sorts review findings.                    | Your project's checks and the Critic decide. |
| **Triage**  | Sorts pull request comments.                                               | Keyword rules sort them.                     |
| **The Map** | Labels each area.                                                          | Rules label the areas.                       |

Jev never answers a chat, edits files, runs code, answers an approval card, loosens a mode, raises a budget or picks the model itself.

To connect it, see [Connect Jev](meet-jev.md).

## Check changes with Jev

The switch is on Jev's screen in **Settings → AI providers**. It's on by default. With it on, Jev also receives code diffs: it watches proposed edits and verifies the final diff. If Jev finds a change incomplete, a stronger model redoes it once.

Jev also reads short previews of the likeliest files, only to compare file rankings. Agents get the same files as before.

Turn it off to keep diffs and file previews on your computer.

![Settings on Jev's screen, with Check changes with Jev](images/jev-advisor-light.png)

## What Jev reads

| Sent                                                                               | Never sent                      |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| Your request, the previous request and a short task summary                        | Keys and tokens                 |
| The text of files you attach                                                       | Tool output                     |
| Diffs and short file previews, with **Check changes with Jev** on                  | Your full chat history          |
| Some file contents for the Map. See [what Jev reads](map-areas.md#what-jev-reads). | Secret and `.sparkignore` files |

Everything is redacted first. TypeSafe doesn't train on it.

## What it costs

TypeSafe bills your TypeSafe account by input tokens. A typical call costs well under $0.0001. The chat's **Work** panel and **Settings → Usage** show Jev's cost.

## How you know Jev took part

Hover the chip on a reply, such as **Question**:

- **Jev not connected**: the rules decided.
- **Not asked**: this step didn't need Jev, for example "pinned, no Jev call".
- **Jev timed out** or **Jev failed**: Spark used the rules.

With the **Spark** switch off, Jev isn't called for chats. The Map still uses it.
