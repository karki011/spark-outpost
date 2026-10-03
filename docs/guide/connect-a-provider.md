---
title: Connect an AI provider
section: Get started
type: start
order: 130
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

1. Select the provider's tile. If it says **CLI not installed**, select **Run it** to install, and Spark checks again.

   ![The AI providers tiles with Claude and Jev connected](images/providers-tiles-light.png)

2. Under **How to connect**, pick a tab:
   - **Local CLI**: select **Detect and verify**. If you aren't signed in, Spark opens a terminal with the command.
   - **API key**: paste the key into the key field and select **Verify key**.
3. Wait for **Connected**.
4. Under **Test**, select **Send test message**. Spark shows which model answered and how long it took.

![The Claude screen on the Connect your AI providers step, with the API key tab open](images/getting-started-provider-light.png)

Select **Back**, **Done** or press **Esc** to return to the tiles.

## Where your sign-in lives

- **Local CLI**: in the CLI. Spark never reads or stores it.
- **API key**: in your system keychain, never in Spark's database or logs.

> **Important:** Paste keys only into the key field, never into a chat message. See [Keep keys out of chats](protect-secrets.md).

Something failed? See [A provider won't connect](trouble-providers.md).

**Next:** [Choose defaults for new chats](chat-defaults.md)
