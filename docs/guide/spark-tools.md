---
title: Spark tools for agents
section: Reference
type: reference
order: 618
summary: What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.
---

Agents get the `spark_*` tools their chat can use.

## Tools that read

| You ask about                                              | Tool                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What needs you, failed chats, flagged tickets              | `spark_attention`                                                                                                     |
| Chats, matching lines, a shared chat, runs, queue, turns   | `spark_chats`, `spark_chat`, `spark_chat_history`                                                                     |
| A run or task: plan, files changed, cost                   | `spark_run`, `spark_task`                                                                                             |
| Spend, activity, analytics, the morning brief              | `spark_spend`, `spark_activity`, `spark_analytics`, `spark_brief`                                                     |
| Pull requests, their checks and reviews                    | `spark_pull_requests`, `spark_pr`, `spark_pr_follow_up`                                                               |
| Providers, models, connectors, settings, projects          | `spark_providers`, `spark_models`, `spark_connectors`, `spark_settings`, `spark_projects`                             |
| The Map, and what breaks if a file changes                 | `spark_map`                                                                                                           |
| Where something lives in the code                          | `spark_find`                                                                                                          |
| Your MCP servers and where each is on                      | `spark_mcp_servers`                                                                                                   |
| Open terminals                                             | `spark_terminals`                                                                                                     |
| The Browser pane's tabs, pages, screenshots, logs, preview | `spark_browser_tabs`, `spark_browser_read`, `spark_browser_screenshot`, `spark_browser_logs`, `spark_browser_preview` |
| Saved sign-ins, without their values                       | `spark_browser_signins`                                                                                               |
| Tickets, one in full, or a search of every ticket          | `spark_tickets`                                                                                                       |
| A Slack thread by link, or a search of what you allowed    | `spark_slack`                                                                                                         |
| Your Sparks, and the jobs and replies from an `@` mention  | `spark_sparks`, `spark_chat`                                                                                          |
| The audit log, including actions that ran without review   | `spark_audit`                                                                                                         |
| How Spark works, this guide                                | `spark_guide`, `spark_docs`                                                                                           |
| Your [calendar](calendar.md#let-agents-use-it)             | `spark_calendar`                                                                                                      |
| Jira or Confluence                                         | `spark_jira`, `spark_confluence`                                                                                      |

## Tools that act

| Action                                      | Tool                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create, comment on, move or assign a ticket | `spark_create_ticket`, `spark_comment_ticket`, `spark_transition_ticket`, `spark_assign_ticket`         |
| Post to an allowed Slack channel or thread  | `spark_slack_post`                                                                                      |
| Start a PR follow-up round                  | `spark_pr_follow_up_round`                                                                              |
| Push the chat's branch, open its PR         | `spark_push`, `spark_pull_request` (no card)                                                            |
| Add or change a Spark                       | `spark_create_spark`, `spark_update_spark`                                                              |
| Add, change, switch or remove an MCP server | `spark_add_mcp_server`, `spark_update_mcp_server`, `spark_switch_mcp_server`, `spark_remove_mcp_server` |
| Open a site, act, debug                     | `spark_browser_open`, `spark_browser_act`, `spark_browser_devtools`                                     |
| Sign in, or hand you the tab (always asks)  | `spark_browser_sign_in`                                                                                 |
| Use a [Mac app](mac-control.md)             | `spark_mac_apps`, `spark_mac_read`, `spark_mac_act`                                                     |
| Keep one command running after the turn     | `spark_terminal_run`                                                                                    |
| Show a page beside the chat                 | `spark_artifact`                                                                                        |
| Change a calendar event                     | `spark_calendar_edit`                                                                                   |
| Change or delete Jira issues                | `spark_jira_edit`                                                                                       |
| Change Confluence pages                     | `spark_confluence_edit`                                                                                 |

An MCP server card shows the command; fill values in **Settings → MCP servers**.

## Outpost tools

A chat in an [outpost](outposts.md) gets these.

| The agent wants to                           | Tool                  |
| -------------------------------------------- | --------------------- |
| Read the outpost: members, requests, answers | `spark_outpost`       |
| Ask another chat, waiting or not             | `spark_outpost_ask`   |
| Leave a note for the other chats             | `spark_outpost_note`  |
| Propose sub-task chats you review and start  | `spark_outpost_draft` |
| Start sub-task chats now                     | `spark_outpost_start` |

Sub-chats and Sparks' jobs get no `spark_outpost_start`. Another chat's text is never your message.

## Ask Spark tools

[Ask Spark](companion-quick-chat.md#let-ask-spark-act) gets these too, minus publishing, follow-up, terminal runs, sign-ins, outpost asks and starts, artifacts. Its own:

| It can                                        | Tool                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Act on chats, Spark and tickets               | `spark_start_chat`, `spark_send_to_chat`, `spark_stop_chat`, `spark_archive_chat`, `spark_pause`, `spark_start_ticket` |
| Answer a card with **Allow once** or **Deny** | `spark_answer_card`                                                                                                    |
| Post in outposts, tidy the Inbox, meetings    | `spark_post_outpost`, `spark_clear_finished`, `spark_set_aside`, `spark_meeting`                                       |

## When actions ask first

| Agent mode                                                              | Spark                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| **Auto**, **Bypass permissions**, **Approve for me** or **Full access** | Does it at once, with a link.                            |
| **Accept edits**                                                        | Does it when your message asked. Otherwise shows a card. |
| **Manual**, **Plan** and read-only modes                                | Always shows a card.                                     |

![A Create this ticket card with editable title, description, type, priority and labels](images/spark-tools-action-card-light.png)

Edit, then confirm or select **Don't**; the card shows the result or **Try again**.

## Commands after the turn

`spark_terminal_run` runs a command, like a dev server, outside the sandbox. Modes that don't ask start it, marked ran without review; others show **Allow once** or **Reject**.

[Protected paths](protected-paths.md) and push rules hold in every mode. Read-only and no-project turns are refused.

Stopping the turn or quitting stops it.

## What the tools never return

| Never returned               | Instead                                               |
| ---------------------------- | ----------------------------------------------------- |
| File contents                | `spark_find` gives files, functions and line numbers. |
| Your terminals' output       | A terminal's name, folder and running program.        |
| Password and card fields     | `[masked]`, and painted over in screenshots.          |
| Secrets, API keys and tokens | Redacted before the agent sees them.                  |

After private reads, Spark notes [sends elsewhere](approvals.md#sending-data-out-after-reading-secrets).
