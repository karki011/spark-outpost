# Unreleased changes

Changes through 0.1.0-beta.1 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- When the agent compacts its context mid-reply, the work log shows one **Context compacted** line (or a warning when it fails) instead of a "Compact conversation" step.
- Short-lived agent sessions Spark never resumes (model checks, child runs without a session, plugin reviews) are deleted from Claude Code's and Codex's own session lists when they end, where the agent supports it.
- A port that a chat's shell tab, Terminal session or agent command listens on shows on the chat's row, like `:5173`; in the Mac app, selecting it opens that page in the chat's Browser pane.
- **Jump to latest** sits under the middle of the chat again when the context rail is open, instead of the middle of the whole window.
- A **Custom endpoint** provider runs chats on any server that speaks the Anthropic Messages API, such as Ollama, LM Studio, a llama.cpp server or LiteLLM: enter its address (https, or http on localhost), model, an optional fast model and an optional API key in Settings → AI providers, then **Test connection**. The settings and key are kept in the keychain; it runs the claude CLI in the same clean, isolated environment as Z.ai.
- A **Custom endpoint** with an API key can send it as **Authorization: Bearer** (the default, as before) or **x-api-key**, for servers such as Anthropic's API that read only that header. The connection test and chats send the same header, the choice is kept with the key in the keychain, and endpoints saved before keep Bearer.
- A Terminal session can run Gemini CLI, OpenCode or Amp when it is installed. Spark starts it with no arguments in the chat's folder and records only that it started and whether it is running: no steps, usage, approvals, Spark tools or paired-device messages. An agent that is not installed shows as **Not installed**.
- Fixes for rare races: agent error output printed as a turn ends is kept in that turn's audit, a crash while dependencies install no longer leaves the old installer running, a message held for a stopped turn is marked missed instead of queued again, and cancelling GitHub App sign-in waits for its last check to finish before it answers.
