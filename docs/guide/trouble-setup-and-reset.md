---
title: Fix the app, setup or a reset
section: Help
type: troubleshooting
order: 710
summary: Fix startup problems, export diagnostics and reset Spark.
---

Providers: [Providers and keys](trouble-providers.md). Runs: [Runs and pull requests](trouble-runs.md).

## The app

| You see                                     | Why                                                   | Fix                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Taking a quick nap** or **Reconnecting…** | The server stopped answering.                         | Wait for **Back online!**, or **Try now**.                                                                         |
| "Spark Outpost could not continue"          | Database or server didn't start, or an update failed. | Quit and reopen. After an update: [**Open previous version instructions**](updates.md#your-data-during-an-update). |
| "Git is not installed"                      | The Mac app needs Git.                                | Run `xcode-select --install` in Terminal.                                                                          |
| "Another app is using this shortcut"        | Another app has those keys.                           | **Settings → Notifications**: **Change** or **Reset**.                                                             |
| "You have 12 terminals open"                | The limit across chats.                               | Close a tab, or reload to end them all.                                                                            |

> **Important:** Don't delete `~/Library/Application Support/Spark Outpost` to fix start-up: it holds chats and backups.

## Run setup again

Setup reopens at **AI provider** only when you disconnect every provider or reset Spark.

## Send diagnostics with a bug report

1. Select **Export diagnostics** in **Settings → Help**.
2. Check and attach zip.
3. Or, in **Send feedback**, turn on **Include diagnostics**, then **Open email draft** or **Open GitHub issue draft**.

You choose what to send.

| The zip holds                             | It never holds                           |
| ----------------------------------------- | ---------------------------------------- |
| App, Electron and macOS versions          | Chats, prompts or plans                  |
| Connected providers, and how              | File contents                            |
| Settings, without your name               | Keys or tokens                           |
| Database updates run, and recent app logs | Key-like text: it becomes `[redacted:…]` |

Mac exports include overlay geometry and click blockers, never screen text.

Drafts list unsuccessful searches.

## Start over

Reset deletes chats, projects and settings; repositories stay.

1. In **Settings → Reset**, read **What Spark removes** and **What stays**.
2. Turn on **Keep my API keys** to keep provider and Jev keys; GitHub, ticket and MCP tokens always go.
3. Hold **Hold to reset** 1.5 seconds; **Undo** works for 10.
