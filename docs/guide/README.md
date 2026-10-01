# Spark Outpost user guide: outline

This folder is the single source for the Spark Outpost user guide. The app bundles these pages into its **Docs** page, Spark's agents read them through the `spark_docs` tool, and a future website can render the same files.

Status: **outline for review**. Three pages are written in full as a quality sample; every other page is a stub with its planned headings.

## How the pages work

- One Markdown file per page. The file name is the page id and the link: `chats-and-modes.md` opens at `#/docs/chats-and-modes`.
- Each page starts with frontmatter:

  ```yaml
  ---
  title: Chats, modes and autonomy
  section: Work with Spark
  order: 210
  summary: One sentence that shows under the title and in search.
  ---
  ```

  `order` sorts pages; the hundreds digit groups a section (100s, 200s, …). Sections appear in the order of their first page.

- Plain Markdown only (GitHub Flavored Markdown tables are fine). Don't put an `#` heading in the body; the title comes from the frontmatter. Use `##` for tasks and `###` below them.
- Heading links follow GitHub's rules: `## Spark autonomy` is `#spark-autonomy`. Link to another page with a relative link: `[approvals](approvals.md#protected-paths)`.
- Callouts are blockquotes that start with a bold word: `> **Tip:**`, `> **Note:**`, `> **Important:**`.
- A stub says `> **Coming soon.**` as its first line. Docs shows it with a "Soon" tag and `spark_docs` flags it `comingSoon`.
- Screenshots live in `images/` as `<page>-<shot>-light.png` and `<page>-<shot>-dark.png`. Pages link the light one; the app swaps in the dark one when the theme is dark. Regenerate them with `pnpm docs:screenshots` (see `tests/browser/docs-shots.spec.ts`); it runs the app against a seeded demo test database, never your real data.
- Write in second person, short and task-first: "To do X: 1. … 2. …". Use the app's exact labels in **bold**. No marketing.

## Sections and pages

Legend: **Written** is a full page; **Stub** has frontmatter, "Coming soon" and the planned headings. Screenshots are named without the `-light/-dark` suffix.

### Get started

| Page                                        | Status  | Summary                                                                                                             | Screenshots                                                                                                                                                    |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getting-started` Getting started           | Written | Set up Spark Outpost in about two minutes: your name, a theme, a provider and your tools.                           | `getting-started-meet-spark`, `getting-started-theme`, `getting-started-provider`, `getting-started-defaults`, `getting-started-tools`, `getting-started-done` |
| `providers-and-models` Providers and models | Stub    | Connect Claude, Codex and Z.ai, send a test message, pick the default model, mode and effort, and read model cards. | `providers-list`, `providers-test-message`, `providers-defaults`, `providers-model-card`                                                                       |

### Work with Spark

| Page                                            | Status  | Summary                                                                                                                                             | Screenshots                                                                                                                                |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `chats-and-modes` Chats, modes and autonomy     | Written | Start a chat, link a project, pick the agent's mode and choose how much Spark does alone.                                                           | `chats-and-modes-new-chat`, `chats-and-modes-project`, `chats-and-modes-picker`, `chats-and-modes-permissions`, `chats-and-modes-autonomy` |
| `spark-crew` The Spark crew                     | Stub    | How Spark splits bigger work into pieces for Builders, reviews it with a Critic and keeps it in a worktree; Builders at once and Where Spark works. | `spark-crew-pieces`, `spark-crew-work-panel`, `spark-crew-agent-tv`, `spark-crew-projects`                                                 |
| `jev` Jev, Spark's advisor                      | Stub    | What Jev decides and what it never does, connecting it, Check changes with Jev, and what it costs.                                                  | `jev-advisor`, `jev-advice-line`                                                                                                           |
| `ship-and-pull-requests` Ship and pull requests | Stub    | Commit, push and open a PR from a chat, ready or draft, and let Spark follow up on checks and review comments.                                      | `ship-popover`, `ship-pr-strip`, `ship-settings`                                                                                           |
| `terminals` Terminals                           | Stub    | Open a terminal in the chat's worktree or project, run several, and stop a busy one safely.                                                         | `terminals-dock`, `terminals-stop`                                                                                                         |
| `compaction` Long chats and compaction          | Stub    | How Spark keeps long chats within the model's context. Being built now; this page fills in when it ships.                                           | (after the feature lands)                                                                                                                  |

### Stay in control

| Page                                      | Status  | Summary                                                                                                                                    | Screenshots                                                                                              |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `approvals` Approvals and protected paths | Written | What Spark asks before it acts, how to answer an approval card, and which files always ask.                                                | `approvals-command`, `approvals-edit`, `approvals-instructions`, `approvals-hold`, `approvals-allowlist` |
| `privacy-and-secrets` Privacy and secrets | Stub    | Where keys are stored, why to paste keys only in the app's key field, `.sparkignore`, what goes to Jev, and what Spark tools never return. | `privacy-key-field`, `privacy-map-note`                                                                  |
| `guardrails` Guardrails (universal laws)  | Stub    | Rules every agent follows in every chat. Being built now; this page fills in when it ships.                                                | (after the feature lands)                                                                                |

### Your tools

| Page                                    | Status | Summary                                                                                                            | Screenshots                                                 |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `tickets-and-github` Tickets and GitHub | Stub   | Connect GitHub, Linear and Jira, work from the Tickets inbox, and start a chat from a ticket.                      | `tickets-connectors`, `tickets-inbox`, `tickets-start-work` |
| `map` The Map                           | Stub   | See a project's areas and files, find what breaks if a file changes, and what Jev reads to label areas.            | `map-tree`, `map-focus`, `map-sky`                          |
| `spark-tools` Spark tools for agents    | Stub   | The `spark_*` tools every agent gets: what they answer, what they never return, and the confirm cards for actions. | `spark-tools-action-card`                                   |

### Desktop app

| Page                                      | Status | Summary                                                                                                   | Screenshots                                                                |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `desktop-companion` The desktop companion | Stub   | Scout under the notch: quick chat with ⌥Space, sessions with ⌥⇧Space, answering approvals, and Calm mode. | `companion-island-chat`, `companion-island-sessions`, `companion-settings` |
| `updates` Updates                         | Stub   | How the desktop app updates itself, Stable or Beta, and what happens to running work.                     | `updates-section`, `updates-rail-blob`                                     |

### Reference

| Page                              | Status | Summary                                                                                                          | Screenshots                                            |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `settings` Settings reference     | Stub   | Every Settings section and row, what it does and its default.                                                    | `settings-spark`, `settings-projects`                  |
| `troubleshooting` Troubleshooting | Stub   | What to do when the server doesn't answer, a provider isn't signed in, a key is rejected or a shortcut is taken. | `troubleshooting-offline`, `troubleshooting-reconnect` |

## In-app links into the guide

Settings rows and info tips link here with a book icon (`apps/web/src/ui/DocLink.tsx`). A unit test checks each target page and heading exists.

| Where                                             | Opens                             |
| ------------------------------------------------- | --------------------------------- |
| Settings → Spark → How much Spark does alone      | `chats-and-modes#spark-autonomy`  |
| Settings → Spark → If you don't answer a question | `approvals#if-you-dont-answer`    |
| Settings → AI providers → Advisor info tip        | `jev`                             |
| Settings → AI providers → Check changes with Jev  | `jev#check-changes-with-jev`      |
| Settings → Projects → Where Spark works           | `spark-crew#where-spark-works`    |
| Settings → Updates → Channel                      | `updates#stable-or-beta`          |
| Map → what Jev reads info tip                     | `privacy-and-secrets#sparkignore` |
