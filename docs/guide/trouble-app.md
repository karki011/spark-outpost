---
title: The app
section: Troubleshooting
type: troubleshooting
order: 952
summary: Fixes for when Spark Outpost isn't answering, the Mac app doesn't start, a shortcut is taken or too many terminals are open.
---

## The app isn't answering

- **You see:** **Taking a quick nap**, or a **Reconnecting…** banner in a chat.
- **Why:** the Spark Outpost server stopped answering.
- **Fix:** wait a few seconds. Spark retries by itself and says **Back online!**. Select **Try now** to retry at once. Your chat stays open.
- **Still stuck:** in the Mac app, quit Spark Outpost and open it again.

## The Mac app doesn't start

- **You see:** "Spark Outpost could not continue", ending with a reason such as "Postgres did not start".
- **Why:** the database or the server didn't come up, or an update failed.
- **Fix:** quit and open the app again. A database left running by an earlier launch is stopped for you. If it says "Git is not installed", run `xcode-select --install` in Terminal.
- **Still stuck:** if it failed right after an update, select **Open previous version instructions**. See [Your data during an update](updates.md#your-data-during-an-update).

Don't delete `~/Library/Application Support/Spark Outpost` to fix a start-up problem. It holds your chats and backups.

## A shortcut is taken

- **You see:** "Another app is using this shortcut. Pick a different one."
- **Why:** another app registered the same keys.
- **Fix:** open **Settings → Spark → Around the app**, select **Change** next to the shortcut and press new keys with at least one modifier.
- **Still stuck:** select **Reset** to go back to ⌥Space or ⌥⇧Space.

## Too many terminals

- **You see:** "You have 12 terminals open. Close one before opening another."
- **Why:** 12 is the limit across all chats.
- **Fix:** close a terminal tab with its **×**, in this chat or another.
- **Still stuck:** reload the page. That ends every terminal.
