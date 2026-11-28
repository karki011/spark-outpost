---
title: Use a local model or your own endpoint
nav: Local model or endpoint
section: Connections
type: how-to
order: 870
summary: Run chats on Ollama, LM Studio, a llama.cpp server, LiteLLM or any server that speaks the Anthropic Messages API.
---

About 3 minutes. The server must speak the Anthropic Messages API, as Ollama does. How well tools work depends on the model. Spark runs it through the `claude` CLI, so [install that first](connect-a-provider.md#before-you-start).

1. In **Settings → AI providers**, select **Custom endpoint**.
2. Enter the **Server address**, such as `http://localhost:11434`.
3. Enter the **Model**, and optionally a **Fast model**.
4. Add an **API key** if the server needs one. **Send the key as** is **Authorization: Bearer**; pick **x-api-key** for a server that reads only that header, such as Anthropic's API.
5. Select **Test connection**.

## With Ollama

Ollama's default context window is too small for an agent: a chat fails with "Prompt is too long" even though **Test connection** passes.

1. Quit Ollama, then start it from a terminal with a larger window: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`.
2. Run `ollama list` and copy the model's name exactly, such as `qwen3:4b-instruct`.
3. In Spark, enter `http://localhost:11434` as the **Server address** and that name as the **Model**. Leave **API key** empty.

| Fact   | Detail                                                               |
| ------ | -------------------------------------------------------------------- |
| Window | The agent's instructions alone take about 13,000 tokens              |
| Memory | A 4B model with that window used 7.6 GB                              |
| Speed  | Each reply re-reads them; a small model on a laptop takes a minute   |
| Tools  | The model must support tool calls to read, write or run anything     |
| Where  | Messages go to the server address you entered, here on this computer |

**Next:** [Start a chat and link a project](start-a-chat.md)
