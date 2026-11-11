# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

Changes awaiting a release: [Unreleased notes](../../docs/UNRELEASED.md).

## 0.1.0-beta.5

- Attach PDFs, spreadsheets, CSVs and other files up to 20 MB to a message, not only images and text. Claude reads a PDF up to 10 MB directly; other files are handed to the agent in a private folder that is removed when the turn ends.
- The **Trust this folder?** chip has **Trust**, **Not now** and **Review**, so you answer without opening Agent setup. A folder whose setup changed still asks you to review it.
- The Mac app shows a notice when Spark has no Full Disk Access, with **Open System Settings**, **Remind me later** (two hours) and **Don't ask again**.
- ⌥⌘1 to ⌥⌘9 jump to the left bar items in the order shown.
- The Remote control page is redesigned: setup steps with **Download Tailscale**, paired devices as a compact list, and switches grouped by risk. No switch or default changed.
- Sub-agents show their model and effort wherever they appear. Select an agent in a turn to open its card, with its brief and report formatted like chat; cards are more compact and working agents come first. Many agents or pull requests in one turn fold into one line.
- A tab an agent opened in the Browser pane stays open after its turn, until you close it.
- Changing the theme spreads from the control you used, like ink. Reduce Motion still switches at once.
- **Relay**, a built-in Spark, does pull request follow-up: it acts on failing checks, comments from people with write access and the review bots you list in **Settings → Pull requests**, re-requests review from existing reviewers, and updates a branch that is behind or conflicts by merging its base. There is no round cap. A pull request that turns clean shows "PR is clean · ready to merge".
- When a chat opens a pull request, Spark moves its Jira or Linear ticket to the review status. You can comment on and move tickets from the inbox.
- Home changes through the day, shows tomorrow's meetings in the evening, and has **Allow** and **Deny** on its rows. A failed turn offers **Try again** and keeps your unsent text.
- Calendar: a meeting's reminders stop 5 minutes after its start, **Join at start** opens the link at the start time, **Join opens** sets how early Join works, and every island meeting line has **Dismiss**.
- Links you click in Spark open in a Browser view tab, or in your default browser with **Open links in** (Settings → Browser pane).
- Agents get your login-shell variables for pushes, and can wait for a page element in the Browser pane. Fewer false "sent data" flags for sends to this computer.
- Codex runs on codex-acp 2.6.0 (Codex 0.166). A question Codex asks while it keeps working shows as a question card, and a new Codex session is named after its chat, so Codex makes no extra model call to title it.

## 0.1.0-beta.4

- Three new tints in **Settings → Appearance**: **Blaze**, **Acid** and **Violet**, each with a Cloud Grey light side and a Jet Black dark side. Graphite stays the default.
- Codex modes use Codex's own names: **Approve for me** is now **Auto review**, and the new **Workspace access** mode lets Codex work in the project without asking. Like Auto review and Full access, it shows no approval cards; Spark marks its actions ran without review and flags a crossing of your Spark rules.
- Claude runs on claude-agent-acp 0.101.0 and Codex on codex-acp 2.5.0, with the ACP SDK 2.4. Claude no longer makes model calls Spark can't show or measure: predicted next prompts and compaction of an idle chat are off.
- Home shows a **Week recap** on Fridays from 15:00 (a setting): what you got done, what is in progress, and where someone could help, written by your default provider's middle-tier model from your chats, pull requests and tickets, with **For me** and **For my manager** voices, **Refine** to ask for changes, and Copy. **This week so far** writes one early. Nothing is sent anywhere.
- Ask Spark's **Fast (recommended)** model answers at medium effort instead of low (low where a provider offers low but no medium), unless you pick an effort in **Settings → Spark assistant**.
- The morning brief (on your default provider) and plugin reviews (on Claude) run a middle-tier model at medium effort instead of low (low where a provider has no medium), so they reason a little more before writing. A brief still costs about $0.01.
- Home shows today's meetings once, in **Upcoming**. The brief's calendar block keeps today's free time (the day shape, the longest free block and any focus block) and says how many meetings today has, with **See all in Today**.

## 0.1.0-beta.3

- Ask a chat about a repo it doesn't have, like "the identity repo", and the agent finds it by folder or origin name among your projects and **Repos folders** (Settings → Projects; by default the folders that hold your projects), then asks on a **Link** card in every mode. Linking adds it to the chat from your next message. **Clone a repository…** starts in the first repos folder.
- With GitHub connected, an agent can search your account and organizations for a repo that isn't on this Mac (`spark_github_repos`) and ask on a **Clone and link** card, in every mode, to clone it into your first repos folder and link it from your next message; a repo already on this Mac with the same origin gets the **Link** card instead. To answer a question it can make a shallow, read-only copy (`spark_research_repo`): no hooks, submodules or LFS files, reused in the chat and deleted with it, in a temporary folder Claude reads without a prompt per file. Searching and copying follow the agent's mode, count as reading work data, and are not offered to Ask Spark; a turn from a paired device needs **Link a new folder or clone a repo**.
- The chat column is wider (880px instead of 760px), so tables and code blocks in replies fit better.
- Reply text is 15px with tighter line and paragraph spacing, interface text is 14px, and headings, bold text and inline code are lighter.
- A working chat's title in the chat list pulses slowly, and keeps pulsing while you read instead of stopping after a few seconds. It stops when Spark is in the background or Reduce Motion is on.
- When an agent edits a file without asking (Bypass permissions, Accept edits, or Codex Approve for me and Full access), Spark keeps the file's text from before the edit even if the agent writes it at once. Before, the Kept record could miss that file and undo could leave it empty.

## 0.1.0-beta.2

- Spark Outpost needs macOS 13 or later, as its Electron version does; the app, download pages and site no longer claim macOS 12.
- When the agent compacts its context mid-reply, the work log shows one **Context compacted** line (or a warning when it fails) instead of a "Compact conversation" step.
- Short-lived agent sessions Spark never resumes (model checks, child runs without a session, plugin reviews) are deleted from Claude Code's and Codex's own session lists when they end, where the agent supports it.
- A port that a chat's shell tab, Terminal session or agent command listens on shows on the chat's row, like `:5173`; in the Mac app, selecting it opens that page in the chat's Browser pane.
- **Jump to latest** sits under the middle of the chat again when the context rail is open, instead of the middle of the whole window.
- A **Custom endpoint** provider runs chats on any server that speaks the Anthropic Messages API, such as Ollama, LM Studio, a llama.cpp server or LiteLLM: enter its address (https, or http on localhost), model, an optional fast model and an optional API key in Settings → AI providers, then **Test connection**. The settings and key are kept in the keychain; it runs the claude CLI in the same clean, isolated environment as Z.ai.
- A **Custom endpoint** with an API key can send it as **Authorization: Bearer** (the default, as before) or **x-api-key**, for servers such as Anthropic's API that read only that header. The connection test and chats send the same header, the choice is kept with the key in the keychain, and endpoints saved before keep Bearer.
- A Terminal session can run Gemini CLI, OpenCode or Amp when it is installed. Spark starts it with no arguments in the chat's folder and records only that it started and whether it is running: no steps, usage, approvals, Spark tools or paired-device messages. An agent that is not installed shows as **Not installed**.
- Fixes for rare races: agent error output printed as a turn ends is kept in that turn's audit, a crash while dependencies install no longer leaves the old installer running, a message held for a stopped turn is marked missed instead of queued again, and cancelling GitHub App sign-in waits for its last check to finish before it answers.

## 0.1.0-beta.1

- First public beta. Run Claude Code and Codex side by side on your Mac: chats, Terminal sessions, outposts of chats that work together, the Browser pane, Spark Island, tickets, calendar, voice and Mac control.
- Spark Outpost is source available under the Functional Source License (FSL-1.1-MIT): use it, change it and share it for anything but a competing product. Each release becomes MIT two years after it ships.
