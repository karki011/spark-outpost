---
title: Fix the app, setup or a reset
section: Help
type: troubleshooting
order: 710
summary: Fixes for an app that isn't answering or doesn't start, how to send diagnostics with a bug report, and how to start over.
---

For provider errors, see [Providers and keys](trouble-providers.md). For stuck runs and failed pushes, see [Runs and pull requests](trouble-runs.md).

## The app

| You see                                     | Why                                                       | Fix                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Taking a quick nap** or **Reconnecting…** | The server stopped answering.                             | Wait for **Back online!**, or select **Try now**.                                                                         |
| "Spark Outpost could not continue"          | The database or server didn't start, or an update failed. | Quit and reopen. After an update, select [**Open previous version instructions**](updates.md#your-data-during-an-update). |
| "Git is not installed"                      | The Mac app needs Git.                                    | Run `xcode-select --install` in Terminal.                                                                                 |
| "Another app is using this shortcut"        | Another app uses the same keys.                           | In **Settings → Notifications**, select **Change** or **Reset**.                                                          |
| "You have 12 terminals open"                | 12 is the limit across all chats.                         | Close a tab, or reload to end them all.                                                                                   |

> **Important:** Don't delete `~/Library/Application Support/Spark Outpost` to fix a start-up problem. It holds your chats and backups.

## Run setup again

Setup has no replay button; it reopens at **AI provider** when you disconnect every provider or reset Spark.

## Send diagnostics with a bug report

1. Open **Settings → Help** and select **Export diagnostics**.
2. Check the zip, then attach it.
3. Or select **Send feedback**, turn on **Include diagnostics**, and select **Open email draft** or **Open GitHub issue draft**.

Nothing is sent until you send it.

| The zip holds                                        | It never holds                                            |
| ---------------------------------------------------- | --------------------------------------------------------- |
| App, Electron and macOS versions                     | Chats, prompts or plans                                   |
| Which providers are connected, and how               | File contents                                             |
| Your settings, with your name left out               | Keys or tokens                                            |
| Which database updates have run, and recent app logs | Anything that looks like a key: it becomes `[redacted:…]` |

The draft lists Docs searches that found nothing.

## Start over

A reset deletes your chats, projects and settings. Your repositories and pushed branches stay.

1. Open **Settings → Reset** and read **What Spark removes** and **What stays**.
2. Turn on **Keep my API keys** to keep provider and Jev keys. GitHub, ticket and MCP tokens are always removed.
3. Hold **Hold to reset** for 1.5 seconds. You have 10 seconds to select **Undo**.
