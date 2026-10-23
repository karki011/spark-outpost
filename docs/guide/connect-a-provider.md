---
title: Connect an AI provider
section: Get started
type: start
order: 120
summary: Connect Claude, Codex or Z.ai with the local CLI or an API key, then send a test message.
---

You'll connect one provider and check that it answers. About 2 minutes.

## Before you start

Spark runs the `claude` and `codex` CLIs installed on your computer; it doesn't include them.

| Provider       | Needs CLI | Connects with                | Install the CLI                      |
| -------------- | --------- | ---------------------------- | ------------------------------------ |
| **Claude**     | `claude`  | **Local CLI** or **API key** | `npm i -g @anthropic-ai/claude-code` |
| **Codex**      | `codex`   | **Local CLI** or **API key** | `npm i -g @openai/codex`             |
| **Z.ai (GLM)** | `claude`  | **API key** only             | `npm i -g @anthropic-ai/claude-code` |

Z.ai bills its own key, never your Claude account.

## Connect

1. Select the provider's tile. If it says **CLI not installed**, select **Run it** to install.

   ![The AI providers tiles with Claude and Jev connected](images/providers-tiles-light.png)

2. Under **How to connect**, pick **Local CLI** and select **Detect and verify**.
3. Or pick **API key**, paste the key and select **Verify key**.
4. Wait for **Connected**, then select **Send test message** under **Test**.
5. Under **Defaults for new chats**, pick the **Model**, **Mode** and **Effort**.

![The Claude screen on the Connect your AI providers step, with the API key tab open](images/getting-started-provider-light.png)

A **Local CLI** sign-in stays in the CLI. An **API key** goes to your system keychain, never to Spark's database or logs.

> **Important:** Paste keys only into the key field, never into a chat. See [Keep keys out of chats](sparkignore.md#keep-keys-out-of-chats).

If it fails, see [Providers and keys](trouble-providers.md).

**Next:** [Start a chat and link a project](start-a-chat.md)
