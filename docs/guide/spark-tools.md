---
title: Spark tools for agents
section: Your tools
order: 430
summary: What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.
---

You'll learn what an agent can find out about your Spark Outpost, and how to answer when it offers to do something for you. About 2 minutes.

Every agent in every chat gets Spark's own tools, named `spark_*`. With them, an agent can answer questions about your chats, spend, projects and this guide, without you copying anything in.

## Ask Spark about Spark

1. Open any chat, with or without a project.
2. Ask a question about Spark Outpost in plain words, for example:
   - "Which chats are waiting for me?"
   - "What did I spend today, by model?"
   - "What breaks if I change `src/billing/invoice.ts`?"
   - "How do I allow a command in the whole project?"
3. The agent looks it up with its Spark tools and answers. How-to answers come from this guide, with a link to the right page.

In the desktop app, you can also ask from anywhere with **Ask** in the companion. See [Ask Spark](companion-quick-chat.md#ask-spark).

## Which tool answers what

Tools that read change nothing.

| You ask about                                         | Tool                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| What needs you, failed chats, flagged tickets         | `spark_attention`                                                                         |
| Chats, one chat's runs and settings, earlier turns    | `spark_chats`, `spark_chat`, `spark_chat_history`                                         |
| A running task: crew, pieces, budget, Jev's decisions | `spark_run`, `spark_task`, `spark_laws`                                                   |
| Spend, activity, analytics, the morning brief         | `spark_spend`, `spark_activity`, `spark_analytics`, `spark_brief`                         |
| Pull requests and their checks and reviews            | `spark_pull_requests`, `spark_pr`, `spark_pr_follow_up`                                   |
| Providers, models, connectors, settings, projects     | `spark_providers`, `spark_models`, `spark_connectors`, `spark_settings`, `spark_projects` |
| The Map, and what breaks if a file changes            | `spark_map`                                                                               |
| Open terminals                                        | `spark_terminals`                                                                         |
| Tickets                                               | `spark_tickets`                                                                           |
| Your Sparks, their state and standing instructions    | `spark_sparks`                                                                            |
| The audit log                                         | `spark_audit`                                                                             |
| How Spark works, and this guide                       | `spark_guide`, `spark_docs`                                                               |

## Actions ask first

A few tools act for you: create, comment on, move or assign a ticket, open a pull request, start a PR follow-up round, and add or change a [Spark](sparks.md). These never act on their own. The agent proposes, and Spark shows you a confirm card.

![A Create this ticket card with editable title, description, type, priority and labels](images/spark-tools-action-card-light.png)

To answer the card:

1. Read what will happen. The card says where, for example **Linear · ENG**, and who asks: "Claude asks Spark to do this for you."
2. Change any field you want, such as the title or priority.
3. Select the confirm button, such as **Create ticket** or **Open PR**. To say no, select **Don't**. Nothing changes and the agent is told.

The card shows at every Spark autonomy level. If nobody answers within 30 minutes, it's declined and says **Expired**. Every answer goes into the audit log.

## What the tools never return

- File contents and terminal output. For a terminal, agents see only its name, folder and running program.
- Secrets, API keys and tokens. Provider keys and connector tokens are never shown, and results are redacted before the agent sees them.
- Feedback comments. Analytics give counts only.

If a tool reads private data, such as your chats or spend, Spark asks before anything in that run sends data off your computer. See [Sending data out after reading secrets](approvals.md#sending-data-out-after-reading-secrets).

> **Tip:** If an agent can't answer a Spark question, ask it to "check the Spark guide". It then searches these pages with `spark_docs`.

**Next:** [The desktop companion](desktop-companion.md)
