---
title: Spark tools for agents
section: Reference
type: reference
order: 618
summary: What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.
---

Agents get the `spark_*` tools their chat can use. Ask in plain words.

Ticket, Slack and pull request tools need their connector; pull request and map tools need a linked project.

## Tools that read

These change nothing.

| You ask about                                              | Tool                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| What needs you, failed chats, flagged tickets              | `spark_attention`                                                                                                                           |
| Chats, a chat you shared, its runs, queue, earlier turns   | `spark_chats`, `spark_chat`, `spark_chat_history`                                                                                           |
| A running task: crew, pieces, estimate, Jev's decisions    | `spark_run`, `spark_task`, `spark_laws`                                                                                                     |
| Spend, activity, analytics, the morning brief              | `spark_spend`, `spark_activity`, `spark_analytics`, `spark_brief`                                                                           |
| Pull requests, their checks and reviews                    | `spark_pull_requests`, `spark_pr`, `spark_pr_follow_up`                                                                                     |
| Providers, models, connectors, settings, projects          | `spark_providers`, `spark_models`, `spark_connectors`, `spark_settings`, `spark_projects`                                                   |
| The Map, and what breaks if a file changes                 | `spark_map`                                                                                                                                 |
| Where something lives in the code                          | `spark_find`                                                                                                                                |
| Your MCP servers and where each is on                      | `spark_mcp_servers`                                                                                                                         |
| Open terminals                                             | `spark_terminals`                                                                                                                           |
| The Browser pane's tabs, pages, screenshots, logs, preview | `spark_browser_tabs`, `spark_browser_open`, `spark_browser_read`, `spark_browser_screenshot`, `spark_browser_logs`, `spark_browser_preview` |
| Saved sign-ins, without their values                       | `spark_browser_signins`                                                                                                                     |
| Tickets, one in full, or a search of every ticket          | `spark_tickets`                                                                                                                             |
| A Slack thread by link, or a search of what you allowed    | `spark_slack`                                                                                                                               |
| Your Sparks, and the jobs and replies from an `@` mention  | `spark_sparks`, `spark_chat`                                                                                                                |
| The audit log, including actions that ran without review   | `spark_audit`                                                                                                                               |
| How Spark works, and this guide                            | `spark_guide`, `spark_docs`                                                                                                                 |

## Tools that act

The agent proposes, and Spark does it.

| Action                                      | Tool                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create, comment on, move or assign a ticket | `spark_create_ticket`, `spark_comment_ticket`, `spark_transition_ticket`, `spark_assign_ticket`         |
| Post to an allowed Slack channel or thread  | `spark_slack_post`                                                                                      |
| Start a PR follow-up round                  | `spark_pr_follow_up_round`                                                                              |
| Add or change a Spark                       | `spark_create_spark`, `spark_update_spark`                                                              |
| Add, change, switch or remove an MCP server | `spark_add_mcp_server`, `spark_update_mcp_server`, `spark_switch_mcp_server`, `spark_remove_mcp_server` |
| Use a saved sign-in (always asks)           | `spark_browser_sign_in`                                                                                 |

An MCP server card shows the exact command. Agents pass only names of variables and headers; you fill values in **Settings → MCP servers**, for new agent sessions.

## When actions ask first

| Agent mode or autonomy                                                                       | Spark                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Auto**, **Bypass permissions**, **Approve for me**, **Full access**, or **Full auto → PR** | Does it at once, with a link.                            |
| **Accept edits**                                                                             | Does it when your message asked. Otherwise shows a card. |
| **Manual**, **Plan** and read-only modes                                                     | Always shows a card.                                     |
| Any, after the agent read secrets or private data that turn                                  | Always shows a card.                                     |

![A Create this ticket card with editable title, description, type, priority and labels](images/spark-tools-action-card-light.png)

Change any field, then select the confirm button or **Don't**. The card then shows the result with a link, or why it failed with **Try again**. Every action is audited.

Agents open pull requests themselves.

## What the tools never return

| Never returned               | Instead                                               |
| ---------------------------- | ----------------------------------------------------- |
| File contents                | `spark_find` gives files, functions and line numbers. |
| Terminal output              | A terminal's name, folder and running program.        |
| Password and card fields     | `[masked]`, and painted over in screenshots.          |
| Secrets, API keys and tokens | Redacted before the agent sees them.                  |
| Feedback comments            | Analytics give counts only.                           |

After a tool reads private data, such as your chats or spend, Spark asks before that run [sends data out](approvals.md#sending-data-out-after-reading-secrets).
