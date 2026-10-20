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

| You post                                      | What happens                                                  |
| --------------------------------------------- | ------------------------------------------------------------- |
| `@api add GET /usage and open a PR`           | The API chat builds on its branch and opens its pull request. |
| `@fe build the page against the new endpoint` | The frontend chat builds in its own repo, under its own mode. |
| `@docs describe the page`                     | The docs chat writes the page in the docs repo.               |
| `The response is paged.`                      | A note: it starts no work and stays in the thread.            |

Each answer lands under its request, with its branch and pull request.

Only members can be asked. Agents can [ask each other](outpost-asks.md), and a chat can [start or propose a story](outpost-stories.md) of sub-tasks.

Set one up: [Work across chats in an outpost](outposts.md). See also [What an outpost request may do](outpost-permissions.md).
