---
title: Settings reference
section: Reference
order: 610
summary: What each Settings section holds, its main defaults, and which page explains it.
---

Use this page to find where a setting lives. To open Settings, select **Settings** at the bottom of the rail. Each row's book icon opens the guide at the right page.

## Spark

How Spark talks to you and how it works. Rows are grouped:

| Group                  | Rows and defaults                                                                                                                                       | Read more                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **You and Spark**      | **What should Spark call you?**, **Personality** (**Friendly**)                                                                                         | [Meet Spark](meet-spark.md)                                                                                 |
| **How Spark works**    | **Spark** (on), **How much Spark does alone** (**Automatic**), **Spend cap per task**, **If you don't answer a question** (**10s**)                     | [Spark autonomy](chats-and-modes.md#spark-autonomy), [If you don't answer](approvals.md#if-you-dont-answer) |
| **Context compaction** | **Warn when context is** (60%), **Compact automatically at** (80%)                                                                                      | [Long chats and compaction](compaction.md)                                                                  |
| **Pull requests**      | **Open pull requests as** (**Ready for review**), **When checks still fail in Full auto** (**Open a draft PR**), **Follow up on pull requests** (on)    | [Ship and pull requests](ship-and-pull-requests.md)                                                         |
| **Around the app**     | **Morning brief** (7:00), **Status companion** (**Show**), and in the Mac app **Show Spark Island** (on), the two shortcuts and **Island chimes** (off) | [Spark Island](desktop-companion.md)                                                                        |

## Sparks

Your named teammates: each one's face, role and state, with **Edit** and **New Spark**. Editing opens the same sheet as on Home. See [Sparks, your named teammates](sparks.md).

## AI providers

Connect, test and disconnect Claude, Codex and Z.ai, pick the default provider and each one's **Defaults for new chats**. Jev is under **Advisor**, with **Check changes with Jev**. See [Connect an AI provider](connect-a-provider.md) and [Jev, Spark's advisor](jev.md).

## Models

Model cards: what each model costs, how it did on Spark's benchmark, and when Spark uses it. See [Providers and models](providers-and-models.md).

## Usage

Tokens and cost for every reply, by provider. Codex costs are estimates, marked with **~**.

## Projects

The folders you linked, whether you trust their hooks, allow rules and MCP servers, and per project **Builders at once** (up to 3) and **Where Spark works** (**Each chat in its own worktree (recommended)**). See [The Spark crew](spark-crew.md#where-spark-works).

## Connectors

GitHub, Jira and Linear. See [Tickets and GitHub](tickets-and-github.md).

## MCP servers

Add MCP servers or paste a config from another app. Servers start off; turn one on for all chats, some projects, or one chat with `/mcp`.

## Appearance

The theme. **Graphite** is the default. See [Pick a theme](meet-spark.md#pick-a-theme).

## Updates

In the Mac app only: version, **Channel** (**Stable**, or **Beta** in beta builds), **Download updates automatically** (on) and **Check for updates**. See [Updates](updates.md).

## Help

In the Mac app: the version (with a **Beta** label in beta builds), the **Logs folder** with **Show in Finder**, and **Send anonymous heartbeat** (on; see [Anonymous heartbeat](privacy-and-secrets.md#anonymous-heartbeat)). Everywhere: **Export diagnostics** and **Send feedback**. See [Send diagnostics with a bug report](troubleshooting.md#send-diagnostics-with-a-bug-report).

## Reset

Start Spark Outpost over from the first setup step. See [Start over](troubleshooting.md#start-over).

**Next:** [Troubleshooting](troubleshooting.md)
