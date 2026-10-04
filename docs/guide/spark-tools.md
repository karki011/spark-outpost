---
title: Spark tools for agents
section: Reference
type: reference
order: 618
summary: What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.
---

Every agent in every chat gets Spark's own `spark_*` tools. Ask in plain words, such as "Which chats are waiting for me?" or "What did I spend today?".

## Tools that read

These change nothing.

| You ask about                                            | Tool                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| What needs you, failed chats, flagged tickets            | `spark_attention`                                                                         |
| Chats, one chat's runs and queue, earlier turns          | `spark_chats`, `spark_chat`, `spark_chat_history`                                         |
| A running task: crew, pieces, estimate, Jev's decisions  | `spark_run`, `spark_task`, `spark_laws`                                                   |
| Spend, activity, analytics, the morning brief            | `spark_spend`, `spark_activity`, `spark_analytics`, `spark_brief`                         |
| Pull requests, their checks and reviews                  | `spark_pull_requests`, `spark_pr`, `spark_pr_follow_up`                                   |
| Providers, models, connectors, settings, projects        | `spark_providers`, `spark_models`, `spark_connectors`, `spark_settings`, `spark_projects` |
| The Map, and what breaks if a file changes               | `spark_map`                                                                               |
| Where something lives in the code                        | `spark_find`                                                                              |
| Your MCP servers and where each is on                    | `spark_mcp_servers`                                                                       |
| Open terminals                                           | `spark_terminals`                                                                         |
| Tickets, one in full, or a search of every ticket        | `spark_tickets`                                                                           |
| Your Sparks and their standing instructions              | `spark_sparks`                                                                            |
| The audit log, including actions that ran without review | `spark_audit`                                                                             |
| How Spark works, and this guide                          | `spark_guide`, `spark_docs`                                                               |

## Tools that act

The agent proposes, and Spark does it.

| Action                                      | Tool                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create, comment on, move or assign a ticket | `spark_create_ticket`, `spark_comment_ticket`, `spark_transition_ticket`, `spark_assign_ticket`         |
| Open a pull request                         | `spark_open_pr`                                                                                         |
| Start a PR follow-up round                  | `spark_pr_follow_up_round`                                                                              |
| Add or change a Spark                       | `spark_create_spark`, `spark_update_spark`                                                              |
| Add, change, switch or remove an MCP server | `spark_add_mcp_server`, `spark_update_mcp_server`, `spark_switch_mcp_server`, `spark_remove_mcp_server` |

An MCP server card shows the exact command, because it runs on your computer. Agents pass only names of variables and headers; you fill values in **Settings → MCP servers**. Changes apply to new agent sessions.

## When actions ask first

| Agent mode or autonomy                                                                       | Spark                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Auto**, **Bypass permissions**, **Approve for me**, **Full access**, or **Full auto → PR** | Does it straight away and shows a link.                         |
| **Accept edits**                                                                             | Does it when your message asked for it. Otherwise shows a card. |
| **Manual**, **Plan** and read-only modes                                                     | Always shows a card.                                            |
| Any, after the agent read secrets or private work data in the turn                           | Always shows a card.                                            |

![A Create this ticket card with editable title, description, type, priority and labels](images/spark-tools-action-card-light.png)

On the card, change any field, then select the confirm button, such as **Create ticket**, or **Don't**. The agent doesn't wait: answer whenever you like. Every action goes into the audit log.

## What the tools never return

| Never returned               | Instead                                               |
| ---------------------------- | ----------------------------------------------------- |
| File contents                | `spark_find` gives files, functions and line numbers. |
| Terminal output              | A terminal's name, folder and running program.        |
| Secrets, API keys and tokens | Results are redacted before the agent sees them.      |
| Feedback comments            | Analytics give counts only.                           |

After a tool reads private data, such as your chats or spend, Spark asks before that run [sends data out](approvals.md#sending-data-out-after-reading-secrets).
