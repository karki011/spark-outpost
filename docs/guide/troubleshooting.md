---
title: Troubleshooting
section: Reference
order: 620
summary: What to do when the app doesn't answer, a provider won't connect, no models show, a test message or run fails, or a shortcut is taken, and how to send diagnostics with a bug report.
---

Find your problem below and follow the steps. Each fix takes a minute or two.

## Spark Outpost is not answering

You see **Taking a quick nap** ("The Spark Outpost server isn't answering"), or a **Reconnecting…** banner in a chat.

1. Wait a few seconds. Spark retries on its own and says **Back online!** when it's back. Your chat stays open.
2. Select **Try now** to retry straight away.
3. If it keeps failing in the desktop app, quit Spark Outpost and open it again.

## A provider won't connect

Open **Settings → AI providers** and open the provider's card. The message under it says what's wrong:

- **"The `claude` CLI isn't installed or isn't on your PATH"** or **"API key mode also needs the `claude` CLI installed"**: install it with `npm i -g @anthropic-ai/claude-code` (for Codex, `npm i -g @openai/codex`), then select **Try again**. Spark doesn't include the CLIs; Z.ai needs `claude` too.
- **"Claude runs through the `claude` CLI, which isn't installed"** in a chat: the CLI was removed or moved. Install it again, then resend.
- **"You're not logged in to the `claude` CLI"**: run `claude auth login` (for Codex, `codex login`) in a terminal, then select **Try again**.
- **"Couldn't reach …"**: check your internet connection and try again.

In a chat, the same problem shows as "… isn't signed in. Open Settings, reconnect …, and try again." Reconnect the provider on its card, then send your message again.

## A key was rejected

- **"rejected this key (401 Unauthorized)"**: the key is wrong or revoked. Copy it again from the provider, paste it into the key field and select **Verify key**.
- **"denied access (403 Forbidden)"**: the key works but lacks permission. Check its permissions with the provider.
- **"can't use any models"**: check which project the key belongs to.
- **"This looks like an OpenAI key. Paste it under Codex instead."**: you pasted it on the wrong card.

## No models in the model picker

The picker asks the agent for its models when you open it. If it says **No models reported yet**:

1. Check that the provider's card says **Connected**. If it isn't, connect it first.
2. Close the picker and open it again. The first answer can take a few seconds.
3. If it says the agent "took too long to report its models", select **Send test message** on the card to check the provider answers.

## The test message fails

The card says **The test message failed:** and why:

- **"rejected the stored key (401)"** or **"the stored key is missing from the keychain"**: paste the key again and select **Verify key**.
- **"is rate limiting this key (429)"**: wait a minute, then try again.
- **"no default model is selected"**: pick a **Model** under **Defaults for new chats**.
- **"`claude` is no longer on your PATH"**: reinstall the CLI, then select **Detect and verify** on the **Local CLI** tab.
- **"didn't answer within 90 seconds"**: check your connection, then try again.

## A provider is rate limited

A chat says "… is rate limited. Try again in a minute." Wait a minute and send your message again, or switch the chat to another provider with the model button.

## A run seems stuck

1. Check whether it's waiting for you. Look for a card under **Waiting for you** above the message box, or on **Home** under **What needs you today**.
2. To ask what it's doing without interrupting it, open the chat's **Work** panel, or use **Ask for update** in Spark Island.
3. To stop it, select **Stop** in the message box. The turn says "Stopped before finishing." Then send a new message to try again.

If Spark Outpost stopped while a run was working, the run says its outcome is unknown. Nothing is retried on its own, so send the request again.

## The desktop app doesn't start

1. Read the message. "Spark Outpost could not continue" ends with the reason, such as "Postgres did not start" or "The API did not answer within 120 seconds".
2. Quit Spark Outpost and open it again. A database left running by an earlier launch is stopped for you.
3. If it says "Git is not installed", run `xcode-select --install` in Terminal, then reopen the app. Chats work without Git.
4. If it failed right after an update, select **Open previous version instructions**. See [Your data during an update](updates.md#your-data-during-an-update).

Your data is in `~/Library/Application Support/Spark Outpost`. Don't delete that folder to fix a start-up problem; it holds your chats and backups.

## A shortcut is taken

Settings says "Another app is using this shortcut. Pick a different one."

1. Open **Settings → Spark** and scroll to **Around the app**.
2. Select **Change** next to the shortcut and press new keys, with at least one modifier key.

See [Change a shortcut](companion-quick-chat.md#change-a-shortcut).

## Too many terminals

"You have 12 terminals open. Close one before opening another." Close a terminal tab with its **×**, in this chat or another. See [Terminals](terminals.md#limits).

## Run setup again

Setup has no replay button. It comes back in two cases:

- You disconnect every provider. Spark Outpost needs at least one, so setup reopens at **AI provider**.
- You reset Spark in **Settings → Reset**. This deletes your chats, projects and settings, so read the lists on that screen first.

## Send diagnostics with a bug report

Diagnostics help the Spark Outpost team see what went wrong. The zip holds the app, Electron and macOS versions, which providers are connected and how (CLI or API key), your settings with your name left out, which database updates have run, and recent app logs. It never holds chats, prompts, file contents, keys or tokens; anything in a log or setting that looks like a key or token is replaced with `[redacted:…]`.

1. Open **Settings → Help**, or choose **Help → Export Diagnostics…** in the menu bar.
2. Select **Export diagnostics** and pick where to save the zip. In the browser it downloads to your downloads folder instead.
3. Open the zip and look through it if you like, then attach it to your bug report.

To report the problem in the same step, use **Send feedback** under **Settings → Help** (or **Help → Send Feedback…**): describe what happened and what you expected, turn on **Include diagnostics**, and select **Open email draft** (or **Open GitHub issue draft**). Spark saves the zip, opens a draft and tells you where the zip is, so you can attach it. Nothing is sent until you send it yourself.

The app's own logs are in `~/Library/Application Support/Spark Outpost/logs`. **Logs folder** under **Settings → Help** shows the path, and **Show in Finder** opens it. Spark keeps about 8 MB of logs and replaces the oldest first.

## Start over

To clear everything and start from the first setup step:

1. Open **Settings → Reset** and read **What Spark removes** and **What stays**. Your repositories and pushed branches stay.
2. To keep your provider keys, turn on **Keep my API keys**.
3. Press and hold **Hold to reset** for 1.5 seconds.
4. You have 10 seconds to select **Undo**. After that, the reset can't be undone.

> **Tip:** Still stuck? Ask in any chat, for example "Why did my last run fail?". The agent can read your chats and runs with Spark's tools.
