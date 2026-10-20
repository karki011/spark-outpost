---
title: When to use an outpost
section: Understand Spark
type: concept
order: 515
summary: What an outpost is for, how it differs from one chat, an example, and what it can't do yet.
---

An outpost is one thread where you direct several chats that each do their own work. Use it when a job spans repos or roles and you want every answer in one place.

## Outpost or one chat

| Use        | When                                                                 | You get                                                                            |
| ---------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| One chat   | The work lives in one project. The agent may use its own sub-agents. | One branch and one pull request.                                                   |
| An outpost | The work spans repos or roles, such as frontend, API and docs.       | Each chat keeps its own project, agent, mode, branch and pull request. You direct. |

## An example

You are adding a usage page, with a frontend chat, an API chat and a docs chat in the outpost **Usage by user**.

| You post                                      | What happens                                                   |
| --------------------------------------------- | -------------------------------------------------------------- |
| `@api add GET /usage and open a PR`           | The API chat builds on its branch and opens its pull request.  |
| `@fe build the page against the new endpoint` | The frontend chat builds in its own repo, under its own mode.  |
| `@docs describe the page`                     | The docs chat writes the page in the docs repo.                |
| `The response is paged.`                      | A note. It starts no work and stays in the thread for reading. |

Each answer lands under its request with its branch, files and pull request, so you read all three without switching chats.

## What it can't do yet

| Not yet                           | Today                              |
| --------------------------------- | ---------------------------------- |
| Asking a chat that isn't a member | Add the chat to the outpost first. |

Agents can [ask each other](outpost-asks.md), and a chat can [start or propose a story](outpost-stories.md) of sub-tasks.

To set one up, see [Work across chats in an outpost](outposts.md). For what a request may do, see [What an outpost request may do](outpost-permissions.md).
