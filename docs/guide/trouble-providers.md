---
title: Providers and keys
section: Help
type: troubleshooting
order: 712
summary: Fixes for a provider that won't connect, a rejected key, an empty model picker, a failing test message and rate limits.
---

In **Settings → AI providers**, select the provider's tile: the message under **Test** names the problem.

## A provider won't connect

| You see                                                  | Fix                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "The `claude` CLI isn't installed or isn't on your PATH" | `npm i -g @anthropic-ai/claude-code` (Codex: `npm i -g @openai/codex`), then **Try again**. |
| "API key mode also needs the `claude` CLI installed"     | Install the CLI above; Z.ai and API keys use it.                                            |
| "You're not logged in to the `claude` CLI"               | `claude auth login` (or `codex login`), then **Try again**.                                 |
| "Couldn't reach …"                                       | Check your connection.                                                                      |
| In a chat: "… isn't signed in" or "… couldn't sign in"   | Reconnect the provider, then resend.                                                        |

## A key was rejected

| You see                                | Fix                                            |
| -------------------------------------- | ---------------------------------------------- |
| "rejected this key (401 Unauthorized)" | Copy it again; **Verify key**.                 |
| "denied access (403 Forbidden)"        | Check the key's permissions with the provider. |
| "can't use any models"                 | Check the key's project.                       |

## No models in the picker

| You see                    | Fix                                                   |
| -------------------------- | ----------------------------------------------------- |
| **No models reported yet** | Check the tile says **Connected**; reopen the picker. |
| **Unavailable** on a model | Your sign-in can't use it: **Switch to …**.           |

## The test message fails

| You see                                                                          | Fix                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| "rejected the stored key (401)" or "the stored key is missing from the keychain" | Paste it again; **Verify key**.                                     |
| "is rate limiting this key (429)"                                                | Wait a minute.                                                      |
| "no default model is selected"                                                   | Pick a **Model** under **Defaults for new chats**.                  |
| "`claude` is no longer on your PATH"                                             | Reinstall the CLI; **Detect and verify**.                           |
| "didn't answer within 90 seconds"                                                | Check your connection.                                              |
| Waiting for the keychain                                                         | Answer the macOS [keychain prompt](mac-privacy.md#keychain-prompt). |

## A provider is rate limited

Wait a minute or switch provider in the picker.
