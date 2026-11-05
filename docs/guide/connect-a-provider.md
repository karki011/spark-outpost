---
title: Connect an AI provider
section: Get started
type: start
order: 120
summary: Connect Claude, Codex, Z.ai or a custom endpoint with the local CLI, an API key or a server address, then send a test message.
---

Connect one provider and check that it answers. About 2 minutes.

## Before you start

Spark runs your installed CLIs: `npm i -g @anthropic-ai/claude-code` for `claude`, `npm i -g @openai/codex` for `codex`.

| Provider            | Needs CLI | Connects with                        |
| ------------------- | --------- | ------------------------------------ |
| **Claude**          | `claude`  | **Local CLI** or **API key**         |
| **Codex**           | `codex`   | **Local CLI** or **API key**         |
| **Z.ai (GLM)**      | `claude`  | **API key** only                     |
| **Custom endpoint** | `claude`  | [Server address](custom-endpoint.md) |

Z.ai bills its own key, never your Claude account.

## Connect

1. Select the provider's tile. If it says **CLI not installed**, select **Run it**.

   ![The AI providers tiles with Claude and Jev connected](images/providers-tiles-light.png)

2. Under **How to connect**, pick **Local CLI** and select **Detect and verify**.
3. Or pick **API key**, paste the key and select **Verify key**.
4. Wait for **Connected**, then **Send test message** under **Test**.
5. Under **Defaults for new chats**, pick the **Model**, **Mode** and **Effort**.

![The Claude screen on the Connect your AI providers step, with the API key tab open](images/getting-started-provider-light.png)

A **Local CLI** sign-in stays in the CLI. An **API key** goes to your system keychain, never to Spark's database or logs.

> **Important:** Paste keys only into the key field, never into a chat. See [Keep keys out of chats](sparkignore.md#keep-keys-out-of-chats).

If it fails, see [Providers and keys](trouble-providers.md).

**Next:** [Start a chat and link a project](start-a-chat.md)
