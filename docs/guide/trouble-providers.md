---
title: Providers and keys
section: Troubleshooting
type: troubleshooting
order: 954
summary: Fixes for a provider that won't connect, a rejected key, an empty model picker, a failing test message and rate limits.
---

Open **Settings → AI providers** and select the provider's tile. The message under **Test** says what's wrong.

## A provider won't connect

| You see                                                  | Why                               | Fix                                                                                              |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| "The `claude` CLI isn't installed or isn't on your PATH" | Spark doesn't include the CLIs.   | `npm i -g @anthropic-ai/claude-code`, or `npm i -g @openai/codex` for Codex, then **Try again**. |
| "API key mode also needs the `claude` CLI installed"     | Z.ai and API keys run through it. | Install the CLI as above.                                                                        |
| "You're not logged in to the `claude` CLI"               | The CLI has no sign-in.           | Run `claude auth login`, or `codex login`, then **Try again**.                                   |
| "Couldn't reach …"                                       | No connection to the provider.    | Check your internet connection.                                                                  |
| In a chat: "… isn't signed in"                           | The sign-in ended.                | Reconnect on the provider's screen, then resend.                                                 |

**Still stuck:** select **Detect and verify** on the **Local CLI** tab to rerun every check.

## A key was rejected

| You see                                                        | Why                              | Fix                                      |
| -------------------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| "rejected this key (401 Unauthorized)"                         | The key is wrong or revoked.     | Copy it again and select **Verify key**. |
| "denied access (403 Forbidden)"                                | The key lacks permission.        | Check its permissions with the provider. |
| "can't use any models"                                         | The key's project has no models. | Check which project the key belongs to.  |
| "This looks like an OpenAI key. Paste it under Codex instead." | Wrong provider's screen.         | Paste it on the right one.               |

## No models in the picker

- **You see:** **No models reported yet**.
- **Why:** the picker asks the agent for its models when you open it.
- **Fix:** check the tile says **Connected**, then close and reopen the picker. The first answer can take a few seconds.
- **Still stuck:** select **Send test message** on the provider's screen.

## The test message fails

| You see                                                                          | Fix                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| "rejected the stored key (401)" or "the stored key is missing from the keychain" | Paste the key again and select **Verify key**.                      |
| "is rate limiting this key (429)"                                                | Wait a minute.                                                      |
| "no default model is selected"                                                   | Pick a **Model** under **Defaults for new chats**.                  |
| "`claude` is no longer on your PATH"                                             | Reinstall the CLI, then **Detect and verify**.                      |
| "didn't answer within 90 seconds"                                                | Check your connection.                                              |
| It says it's waiting for the keychain                                            | Answer the macOS [keychain prompt](mac-privacy.md#keychain-prompt). |

## A provider is rate limited

- **You see:** "… is rate limited. Try again in a minute."
- **Why:** the provider is throttling your account or key.
- **Fix:** wait a minute and send again.
- **Still stuck:** switch the chat to another provider with the model button.
