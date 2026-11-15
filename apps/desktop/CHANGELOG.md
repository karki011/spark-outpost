# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

Changes awaiting a release: [Unreleased notes](../../docs/UNRELEASED.md).

## 0.1.0-beta.8

- **Settings** has fewer pages: **General** holds your profile, appearance and Notifications; **AI providers** has Providers and Models tabs; **Connectors** has Connectors and MCP servers tabs; **About** holds Updates, Help and Reset. Each connector opens its own page, switches show On or Off, each row has one ⓘ, and long provider and model lists fold.
- The left bar keeps the places you work in. **More** at the bottom holds Pause Spark, Analytics, Docs, Remote control, Settings…, What's new and Send feedback, with a dot when Spark is paused.
- **Sign in with Slack** connects in one click, and Spark watches Slack for messages that @mention you: each shows on Home with Open in Slack and Dismiss, and never counts, chimes or pushes. **Watch for @mentions of me** in Slack settings turns it off.
- **Workflow triggers:** a workflow can run when a turn keeps file changes, before a chat publishes at Full auto → PR (optionally holding on serious findings), on a commit to a branch, or when a Spark pull request opens or gets a new head. **Let runs edit files** lets a workflow's steps leave uncommitted edits.
- **Cards can be answered from** (Remote control page) lets paired devices answer confirmation cards, with **Keep on the Mac** per kind. Spark rules, Mac control and hold-to-confirm cards ask for the device's passkey on each answer.
- Agents can do most of what a person does in Jira: parent, sub-tasks and Team, transitions with fields, comments, links, worklogs, attachments, sprints and versions. Every change shows before and after.
- The context rail shows what the agent can use (skills, commands, MCP servers, plugins and connectors) and the chat's listening ports. A narrow chat floats the rail and the chat list over the thread.

## 0.1.0-beta.7

- **Sparks** has its own page in the left bar, with **Crew** and **Workflows** tabs; Sparks moved out of Settings. A Spark is a folder: its instructions (`SPARK.md`, no length limit), skills and scripts.
- **Workflows** chain Sparks into steps that can wait on each other, with a list editor, a live graph and **Preview**. Run one from **Run**, with `@workflow-id` in a message, or on a schedule (every N minutes, hours, days or weeks). Steps can read and run commands but never edit, commit or push, and a live run view shows each step's time, tokens and cost.
- **Test run** and **Try it** use real agents on a throw-away copy of the project and hold anything that would leave the computer, listed as "would have been sent".
- **Build with an agent** on the Sparks page, or **Ask an agent** on a Spark's page, opens a chat that drafts and changes Sparks, skills and workflows for you. Every change is a card you answer on the Mac.
- A Spark can set **Effort**; its chats and workflow steps start with it.
- **Relay** is removed. Pull request follow-up works as before.
- Chats with a project can read files outside it as their mode allows. Changes outside the project ask, with **Allow for this session**, unless your Spark rules say otherwise. Spark's own data folder stays off limits.
- **Meeting notes (alpha):** ask about a meeting from the chat composer under it, with **Catch me up**, **Suggest a reply**, **Summarize** and more. A meeting with no title gets one from its notes, and **Take notes when I join a meeting** (off by default) starts recording when you press Join or ⌘J in Spark. Transcripts has a live Transcript tab, a delete dialog, a resizable list and new empty and loading states.

## 0.1.0-beta.6

- **Send a test notification** in a paired device's menu on the Remote control page sends one fixed-text push to that device and says what happened.
- Changing the theme spreads with a soft edge. Effort in agent labels reads High, and a sub-agent on another model than the chat shows a **Different model** tag.
- Edits in a chat's work log show the file with +N −M and open to the diff, in every mode. A secret file shows only its path.
- The Map has a **Running chats** switch that marks the files working chats are changing and lists each chat; an area has **Open in chat**.
- A Jira or Linear ticket's detail has a **Linked** section with its parent, subtasks and linked tickets.
- A paired device that loses the Mac says **Can't reach your Mac** and what to try.
- A chat with no title line from the agent takes the title the agent session reports. A name you set is never replaced.
- **Notify when a turn finishes or fails** on the Remote control page (off by default) adds a "Finished" or "Failed" push for a chat. A push about one waiting card opens the chat at that card.
- **Meeting notes (alpha):** **Take notes** on a calendar meeting, or **New meeting** under **Transcripts** in Today, records your microphone and what your Mac plays, shows a transcript labelled You and Others, and writes notes when you stop. Audio is never saved and never leaves the Mac; macOS asks for the microphone and System Audio Recording. On speakers the other side's words can appear twice in the transcript.
- Today has a new look: one card with Month and Day, your reply on each event (Accepted, Maybe, Not answered, Declined), details on hover, and free time marked between meetings in Day.
- The Voice shortcut dictates into the chat you're looking at when Spark is in front; anywhere else it opens the island as before.
- Voice uses one speech model, **Parakeet**; Whisper base and Whisper large v3 turbo are gone and there is no model to pick. If you had chosen a Whisper model, Parakeet downloads by itself the next time Spark starts with Voice on.
- The Mac app checks for an update every hour instead of every 4 hours. With **Download updates automatically** on (the default), a new version downloads in the background as before.
- On a phone, Home rows with several buttons wrap them under the text.

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
