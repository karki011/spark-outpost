---
title: Use a local model or your own endpoint
section: Mac app and providers
type: how-to
order: 419
summary: Run chats on Ollama, LM Studio, a llama.cpp server, LiteLLM or any server that speaks the Anthropic Messages API.
---

You'll run chats on your own model server. About 3 minutes.

It must speak the Anthropic Messages API, as Ollama does. How well tools work depends on the model.

1. In **Settings → AI providers**, select **Custom endpoint**.
2. Enter the **Server address**, such as `http://localhost:11434`.
3. Enter the **Model**, and optionally a **Fast model**.
4. Add an **API key** if the server needs one.
5. Select **Test connection**.

**Next:** [Start a chat and link a project](start-a-chat.md)
