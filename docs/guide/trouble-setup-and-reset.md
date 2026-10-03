---
title: Setup, diagnostics and reset
section: Troubleshooting
type: troubleshooting
order: 958
summary: Why setup comes back, how to send diagnostics with a bug report, and how to start over.
---

## Run setup again

- **You see:** the setup screens again.
- **Why:** setup has no replay button. It comes back when you disconnect every provider, or when you reset Spark.
- **Fix:** connect a provider. Setup reopens at **AI provider**.
- **Still stuck:** see [Providers and keys](trouble-providers.md).

## Send diagnostics with a bug report

1. Open **Settings → Help**, or choose **Help → Export Diagnostics…** in the menu bar.
2. Select **Export diagnostics** and pick where to save the zip.
3. Open the zip to check it, then attach it to your report.

To report in the same step, select **Send feedback**, describe what happened, turn on **Include diagnostics**, and select **Open email draft** or **Open GitHub issue draft**. Nothing is sent until you send it.

| The zip holds                                        | It never holds                                            |
| ---------------------------------------------------- | --------------------------------------------------------- |
| App, Electron and macOS versions                     | Chats, prompts or plans                                   |
| Which providers are connected, and how               | File contents                                             |
| Your settings, with your name left out               | Keys or tokens                                            |
| Which database updates have run, and recent app logs | Anything that looks like a key: it becomes `[redacted:…]` |

The feedback draft also lists Docs searches that found nothing, so the guide can be fixed. You can delete that line before you send.

Logs are in `~/Library/Application Support/Spark Outpost/logs`. **Logs folder** under **Settings → Help** opens it.

## Start over

- **You see:** you want to clear everything.
- **Why:** a reset deletes your chats, projects and settings. Your repositories and pushed branches stay.
- **Fix:**
  1. Open **Settings → Reset** and read **What Spark removes** and **What stays**.
  2. To keep provider and Jev keys, turn on **Keep my API keys**. GitHub, ticket and MCP tokens are always removed.
  3. Press and hold **Hold to reset** for 1.5 seconds.
- **Still stuck:** you have 10 seconds to select **Undo**. After that it can't be undone.
