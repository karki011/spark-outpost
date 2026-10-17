---
title: Providers and keys
section: Help
type: troubleshooting
order: 712
summary: Fixes for a provider that won't connect, a rejected key, an empty model picker, a failing test message and rate limits.
---

Open **Settings → AI providers** and select the provider's tile. The message under **Test** says what's wrong.

## A provider won't connect

| You see                                                  | Fix                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "The `claude` CLI isn't installed or isn't on your PATH" | `npm i -g @anthropic-ai/claude-code`, or `npm i -g @openai/codex` for Codex, then **Try again**. |
| "API key mode also needs the `claude` CLI installed"     | Install the CLI as above. Z.ai and API keys run through it.                                      |
| "You're not logged in to the `claude` CLI"               | Run `claude auth login`, or `codex login`, then **Try again**.                                   |
| "Couldn't reach …"                                       | Check your connection.                                                                           |
| In a chat: "… isn't signed in" or "… couldn't sign in"   | Reconnect on the provider's screen, then resend.                                                 |

Still stuck? **Detect and verify** on **Local CLI** reruns every check.

## A key was rejected

| You see                                                        | Fix                                            |
| -------------------------------------------------------------- | ---------------------------------------------- |
| "rejected this key (401 Unauthorized)"                         | Copy it again and **Verify key**.              |
| "denied access (403 Forbidden)"                                | Check the key's permissions with the provider. |
| "can't use any models"                                         | Check which project the key belongs to.        |
| "This looks like an OpenAI key. Paste it under Codex instead." | Paste it on the right provider's screen.       |

## No models in the picker

| You see                    | Fix                                                        |
| -------------------------- | ---------------------------------------------------------- |
| **No models reported yet** | Check the tile says **Connected**, then reopen the picker. |
| **Unavailable** on a model | Your sign-in can't use it. Select **Switch to …**.         |

## The test message fails

| You see                                                                          | Fix                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| "rejected the stored key (401)" or "the stored key is missing from the keychain" | Paste it again and **Verify key**.                                  |
| "is rate limiting this key (429)"                                                | Wait a minute.                                                      |
| "no default model is selected"                                                   | Pick a **Model** under **Defaults for new chats**.                  |
| "`claude` is no longer on your PATH"                                             | Reinstall the CLI, then **Detect and verify**.                      |
| "didn't answer within 90 seconds"                                                | Check your connection.                                              |
| It says it's waiting for the keychain                                            | Answer the macOS [keychain prompt](mac-privacy.md#keychain-prompt). |

## A provider is rate limited

| You see                                     | Fix                                              |
| ------------------------------------------- | ------------------------------------------------ |
| "… is rate limited. Try again in a minute." | Wait a minute, or switch provider in the picker. |
