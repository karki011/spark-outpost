---
title: Spark tools for agents
section: Reference
type: reference
order: 618
summary: What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.
---

## Tools that read

| About                                                    | Tool                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| What needs you, failed chats, flagged tickets            | `spark_attention`                                                                                                     |
| Chats, matching lines, a shared chat, runs, queue, turns | `spark_chats`, `spark_chat`, `spark_chat_history`                                                                     |
| A run or task: plan, files changed, cost                 | `spark_run`, `spark_task`                                                                                             |
| Spend, activity, analytics, morning brief                | `spark_spend`, `spark_activity`, `spark_analytics`, `spark_brief`                                                     |
| Pull requests, checks, reviews                           | `spark_pull_requests`, `spark_pr`, `spark_pr_follow_up`                                                               |
| Setup and projects                                       | `spark_providers`, `spark_models`, `spark_connectors`, `spark_settings`, `spark_projects`                             |
| The Map, what breaks if a file changes                   | `spark_map`                                                                                                           |
| Where code lives; a repo here or on GitHub               | `spark_find`, `spark_find_repo`, `spark_github_repos`, `spark_research_repo`                                          |
| MCP servers and where each is on                         | `spark_mcp_servers`                                                                                                   |
| Open terminals                                           | `spark_terminals`                                                                                                     |
| The Browser pane                                         | `spark_browser_tabs`, `spark_browser_read`, `spark_browser_screenshot`, `spark_browser_logs`, `spark_browser_preview` |
| Saved sign-ins, without values                           | `spark_browser_signins`                                                                                               |
| Tickets, one in full, a search of all                    | `spark_tickets`                                                                                                       |
| A Slack thread by link, or search what you allowed       | `spark_slack`                                                                                                         |
| Sparks, and `@` mention jobs and replies                 | `spark_sparks`, `spark_chat`                                                                                          |
| The audit, including what ran without review             | `spark_audit`                                                                                                         |
| How Spark works, this guide                              | `spark_guide`, `spark_docs`                                                                                           |
| [Calendar](calendar.md#let-agents-use-it)                | `spark_calendar`                                                                                                      |
| Jira, Confluence or ServiceNow                           | `spark_jira`, `spark_confluence`, `spark_servicenow`                                                                  |

## Combined reads

| Read operation                                                             | Tool            |
| -------------------------------------------------------------------------- | --------------- |
| Combine supported reads (on by default; [turn off](settings.md#code-mode)) | `spark_execute` |

## Tools that act

| Action                                                                                                  | Tool                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create, comment on, move or assign a ticket                                                             | `spark_create_ticket`, `spark_comment_ticket`, `spark_transition_ticket`, `spark_assign_ticket`         |
| Post to an allowed Slack channel or thread                                                              | `spark_slack_post`                                                                                      |
| Start a PR follow-up round                                                                              | `spark_pr_follow_up_round`                                                                              |
| Push the chat's branch, open its PR                                                                     | `spark_push`, `spark_pull_request` (no card)                                                            |
| Add or change a Spark                                                                                   | `spark_create_spark`, `spark_update_spark`                                                              |
| Manage MCP servers                                                                                      | `spark_add_mcp_server`, `spark_update_mcp_server`, `spark_switch_mcp_server`, `spark_remove_mcp_server` |
| Open a site, act, debug                                                                                 | `spark_browser_open`, `spark_browser_act`, `spark_browser_devtools`                                     |
| Sign in, or hand you the tab (always asks)                                                              | `spark_browser_sign_in`                                                                                 |
| Use a [Mac app](mac-control.md)                                                                         | `spark_mac_apps`, `spark_mac_read`, `spark_mac_act`                                                     |
| Run a command past the turn                                                                             | `spark_terminal_run`                                                                                    |
| Show a page beside the chat                                                                             | `spark_artifact`                                                                                        |
| Change a calendar event                                                                                 | `spark_calendar_edit`                                                                                   |
| Change or delete Jira; change ServiceNow                                                                | `spark_jira_edit`, `spark_servicenow_edit`                                                              |
| Change Confluence pages                                                                                 | `spark_confluence_edit`                                                                                 |
| Change [Spark rules](protected-paths.md#spark-rules) or a [plugin](use-claude-plugins.md) (always asks) | `spark_rules_edit`, `spark_plugins_edit`                                                                |

`spark_link_repo` and `spark_clone_repo` always ask ([repos](link-a-repo.md)).

MCP server cards show the command; fill values in **Settings → MCP servers**.

## Outpost tools

For chats in an [outpost](outposts.md).

| To                                           | Tool                  |
| -------------------------------------------- | --------------------- |
| Read the outpost: members, requests, answers | `spark_outpost`       |
| Ask another chat, waiting or not             | `spark_outpost_ask`   |
| Leave the other chats a note                 | `spark_outpost_note`  |
| Draft sub-task chats you review and start    | `spark_outpost_draft` |
| Start sub-task chats now                     | `spark_outpost_start` |

Sub-chats and Sparks' jobs get no `spark_outpost_start`. Another chat's text is never your message.

## Ask Spark tools

[Ask Spark](companion-quick-chat.md#let-ask-spark-act) gets these too, minus publishing, follow-up, terminal runs, sign-ins, outpost asks and starts, artifacts, Spark rules, plugins and repo tools. Its own:

| It can                                        | Tool                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Act on chats, Spark and tickets               | `spark_start_chat`, `spark_send_to_chat`, `spark_stop_chat`, `spark_archive_chat`, `spark_pause`, `spark_start_ticket` |
| Answer a card with **Allow once** or **Deny** | `spark_answer_card`                                                                                                    |
| Post in outposts, tidy the Inbox, meetings    | `spark_post_outpost`, `spark_clear_finished`, `spark_set_aside`, `spark_meeting`                                       |

## When actions ask first

| Agent mode                                                           | Spark                                            |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| **Auto**, **Bypass permissions**, **Auto review** or **Full access** | At once, with a link.                            |
| **Accept edits**                                                     | Does it if your message asked; otherwise a card. |
| **Manual**, **Plan** and read-only modes                             | Always a card.                                   |

![A Create this ticket card with editable title, description, type, priority and labels](images/spark-tools-action-card-light.png)

Edit, then confirm or select **Don't**; the card shows the result or **Try again**.

## Commands after the turn

`spark_terminal_run` runs a command, like a dev server, outside the sandbox until you stop the turn or quit. Modes that don't ask start it, marked ran without review; others ask **Allow once** or **Reject**.

[Protected paths](protected-paths.md) and push rules hold in every mode. Read-only and no-project turns are refused.

## What the tools never return

| Never returned               | Instead                                               |
| ---------------------------- | ----------------------------------------------------- |
| File contents                | `spark_find` gives files, functions and line numbers. |
| Your terminals' output       | Its name, folder and running program.                 |
| Password and card fields     | `[masked]`; painted over in screenshots.              |
| Secrets, API keys and tokens | Redacted before agents see them.                      |

After private reads, Spark notes [sends elsewhere](approvals.md#sending-data-out-after-reading-secrets).
