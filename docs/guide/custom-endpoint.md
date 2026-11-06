---
title: Use a local model or your own endpoint
section: Mac app and providers
type: how-to
order: 419
summary: Run chats on Ollama, LM Studio, a llama.cpp server, LiteLLM or any server that speaks the Anthropic Messages API.
---

About 3 minutes. The server must speak the Anthropic Messages API, as Ollama does. How well tools work depends on the model. Spark runs it through the `claude` CLI, so [install that first](connect-a-provider.md#before-you-start).

1. In **Settings → AI providers**, select **Custom endpoint**.
2. Enter the **Server address**, such as `http://localhost:11434`.
3. Enter the **Model**, and optionally a **Fast model**.
4. Add an **API key** if the server needs one. **Send the key as** is **Authorization: Bearer**; pick **x-api-key** for a server that reads only that header, such as Anthropic's API.
5. Select **Test connection**.

**Next:** [Start a chat and link a project](start-a-chat.md)
