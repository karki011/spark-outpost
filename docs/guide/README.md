# Spark Outpost user guide: outline

This folder is the single source for the Spark Outpost user guide. The app bundles these pages into its **Docs** page, Spark's agents read them through the `spark_docs` tool, and a future website can render the same files.

Status: **outline for review**. Get started, Chats and Approvals are written in full; every other page is a stub with its planned headings.

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
- Keep pages digestible: one job per page, a 1–2 line "what you'll do" lead with a time estimate ("About 1 minute"), numbered steps, paragraphs of 3 lines or fewer, at most one screenshot per step placed right after it, at most one `> **Tip:**`, and a closing `**Next:**` link when pages form a sequence.

## Sections and pages

Legend: **Written** is a full page; **Stub** has frontmatter, "Coming soon" and the planned headings. Screenshots are named without the `-light/-dark` suffix.

### Get started

Get started is a sequence: an overview page that lists the steps, then one short page per setup job, each ending with a **Next:** link.

| Page                                          | Status  | Summary                                                                                   | Screenshots                                           |
| --------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `getting-started` Getting started             | Written | Set up Spark Outpost in about five minutes. Each step has its own short page.             | none                                                  |
| `meet-spark` Meet Spark and pick a theme      | Written | Tell Spark your name, choose how it talks to you, and pick a theme.                       | `getting-started-meet-spark`, `getting-started-theme` |
| `connect-a-provider` Connect an AI provider   | Written | Connect Claude, Codex or Z.ai with the local CLI or an API key, then send a test message. | `providers-tiles`, `getting-started-provider`         |
| `chat-defaults` Choose defaults for new chats | Written | Pick the model, mode and effort new chats start with, and see where to change them later. | `getting-started-defaults`                            |
| `meet-jev` Jev, the advisor                   | Written | What Jev is, why it's optional, and how to connect it during setup.                       | none                                                  |
| `bring-in-your-tools` Bring in your tools     | Written | Check that Git is found, and optionally connect GitHub, Jira and Linear.                  | `getting-started-tools`                               |
| `first-chat` Your first chat                  | Written | Finish setup, send your first message and find what to read next.                         | `getting-started-done`, `chats-and-modes-new-chat`    |

### How Spark works

What Spark adds around the agent, in four short pages. Orders 191–194 place this section between Get started and Work with Spark.

| Page                                                | Status  | Summary                                                                                                    | Screenshots                                                                              |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `how-spark-works` Spark at a glance                 | Written | What Spark adds on top of Claude, Codex and Z.ai, one paragraph each, with links to the details.           | none                                                                                     |
| `prompt-flow` What happens when you send a prompt   | Written | The path from the message box to a pull request, where each card can appear, and what changes without Jev. | `prompt-flow-crew-turn`                                                                  |
| `permissions-and-autonomy` Permissions and autonomy | Written | The agent's mode and Spark autonomy, how they combine, and which cards never go on without you.            | `chats-and-modes-permissions`, `chats-and-modes-autonomy`, `chats-and-modes-diff-drawer` |
| `use-cases` Use cases                               | Written | Six short walkthroughs from a question to a Full auto pull request.                                        | none                                                                                     |

### Work with Spark

| Page                                            | Status  | Summary                                                                                                                                 | Screenshots                                                                                                                                |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `chats-and-modes` Chats, modes and autonomy     | Written | Start a chat, link a project, pick the agent's mode and choose how much Spark does alone.                                               | `chats-and-modes-new-chat`, `chats-and-modes-project`, `chats-and-modes-picker`, `chats-and-modes-permissions`, `chats-and-modes-autonomy` |
| `providers-and-models` Providers and models     | Written | Manage Claude, Codex and Z.ai after setup, change the defaults for new chats, and read the model cards.                                 | `providers-defaults`, `providers-model-cards`                                                                                              |
| `auto-routing` Pick a model for a chat          | Written | Pin a model or let Auto pick one per request, set the effort, and read why Spark chose a model.                                         | `auto-routing-picker`                                                                                                                      |
| `sparks` Sparks, your named teammates           | Written | Make named teammates with a face, a role, their own chat, defaults and standing instructions, then talk to one from Home or a new chat. | none                                                                                                                                       |
| `spark-crew` The Spark crew                     | Written | Who reads, builds and reviews your request, how Spark decides what to do, where the work happens, and how to keep or revert it.         | `spark-crew-plan`                                                                                                                          |
| `pieces` Big work in pieces                     | Written | How the coordinator splits big work into pieces, runs Builders in a shared tree or in worktrees, and ships one PR or several.           | `pieces-card`                                                                                                                              |
| `jev` Jev, Spark's advisor                      | Written | What Jev decides and what it never does, how to connect it, Check changes with Jev, and what it costs.                                  | `jev-advisor`                                                                                                                              |
| `ship-and-pull-requests` Ship and pull requests | Written | Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.                   | `ship-panel`                                                                                                                               |
| `pr-follow-up` Follow up on pull requests       | Written | Let Spark fix failing checks and answer review comments on its PRs, with a confirm card or by itself in Full auto.                      | `pr-follow-up-strip`, `pr-follow-up-card`                                                                                                  |
| `terminals` Terminals                           | Written | Open a terminal in the chat's worktree or project, run several, and stop a busy one safely.                                             | `terminals-dock`, `terminals-stop`                                                                                                         |
| `compaction` Long chats and compaction          | Written | Watch the context ring, choose when Spark compacts a long chat, and read the summary it leaves behind.                                  | `compaction-ring`, `compaction-card`, `compaction-divider`, `compaction-settings`                                                          |

### Stay in control

| Page                                                           | Status  | Summary                                                                                                                                                                                                              | Screenshots                                                                                              |
| -------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `approvals` Approvals and protected paths                      | Written | What Spark asks before it acts, how to answer an approval card, and which files always ask.                                                                                                                          | `approvals-command`, `approvals-edit`, `approvals-instructions`, `approvals-hold`, `approvals-allowlist` |
| `privacy-and-secrets` Privacy and secrets                      | Written | Where keys are stored, why to paste keys only in the app's key field, the warning when a message has a key in it, how Spark redacts secrets, `.sparkignore`, what leaves your computer, and the anonymous heartbeat. | none                                                                                                     |
| `guardrails` Guardrails (universal laws)                       | Written | Five rules Spark applies around every Builder, and the two you meet on the keep card: unexplained removals and checks Spark runs itself.                                                                             | `guardrails-keep-card`                                                                                   |
| `estimates-and-budgets` Estimates, budgets and model demotions | Written | Read the estimate on a plan card, answer the budget card, and see why Spark stopped using a model for a kind of task.                                                                                                | `guardrails-estimate`                                                                                    |

### Your tools

| Page                                        | Status  | Summary                                                                                                                                     | Screenshots                      |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `tickets-and-github` Tickets and GitHub     | Written | Connect GitHub so Spark can open pull requests, connect Jira or Linear, and keep tickets in step with pull requests.                        | `tickets-github`                 |
| `tickets-inbox` Work from the Tickets inbox | Written | Find what needs you, start a chat from a ticket, and follow it through to a pull request.                                                   | `tickets-inbox`, `tickets-start` |
| `map` The Map                               | Written | Open a project's Map, see how it builds, and switch between the Tree, Focus, Outline and Sky views.                                         | `map-tree`                       |
| `map-find-and-filter` Find files on the Map | Written | Find a file, filter by area and file kind (Shift-click to show only one), light up a chat's changes, and see what breaks if a file changes. | `map-focus`                      |
| `map-areas` Map areas and what Jev reads    | Written | What Core, Shared and Feature mean, how to correct an area's label, and exactly what Jev reads to name areas.                               | `map-review`                     |
| `spark-tools` Spark tools for agents        | Written | What agents can look up about Spark, the confirm card they show before acting for you, and what they never see.                             | `spark-tools-action-card`        |

### Desktop app

| Page                                                     | Status  | Summary                                                                                                                                                                  | Screenshots                                          |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `desktop-companion` Spark Island                         | Written | Scout at the top of your screen in the Mac app, what it shows at rest and on hover, session blobs, notch and no-notch displays, and the status companion inside the app. | `companion-settings`                                 |
| `companion-quick-chat` Quick chat and Sessions           | Written | Start a chat with ⌥Space, find a chat and ask for an update with ⌥⇧Space, ask Spark about your chats, and change the shortcuts.                                          | `companion-island-chat`, `companion-island-sessions` |
| `companion-approvals` Answer approvals from Spark Island | Written | Allow or deny with Y and N, answer questions, and hold to confirm a force push.                                                                                          | `companion-island-card`                              |
| `updates` Updates                                        | Written | How the desktop app updates itself, Stable or Beta, the update blob above Settings, and what happens to your data and running work.                                      | `updates-rail-blob`, `updates-section`               |

### Reference

| Page                              | Status  | Summary                                                                                                                                                               | Screenshots |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `settings` Settings reference     | Written | What each Settings section holds, its main defaults, and which page explains it.                                                                                      | none        |
| `troubleshooting` Troubleshooting | Written | What to do when the app doesn't answer, a provider won't connect, no models show, a test message or run fails, the desktop app doesn't start, or a shortcut is taken. | none        |

## In-app links into the guide

Settings rows and info tips link here with a book icon (`apps/web/src/ui/DocLink.tsx`). A unit test checks each target page and heading exists.

| Where                                                             | Opens                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Settings → Spark → How much Spark does alone                      | `chats-and-modes#spark-autonomy`                             |
| Settings → Spark → If you don't answer a question                 | `approvals#if-you-dont-answer`                               |
| Settings → AI providers → Advisor info tip                        | `jev`                                                        |
| Settings → AI providers → Jev → Check changes with Jev            | `jev#check-changes-with-jev`                                 |
| Settings → Projects → Where Spark works                           | `spark-crew#where-spark-works`                               |
| Settings → Projects → Builders at once                            | `pieces#choose-how-many-builders-run-at-once`                |
| Settings → Spark → Warn when context is, Compact automatically at | `compaction#change-when-spark-compacts`                      |
| Settings → Spark → Open pull requests as                          | `ship-and-pull-requests#ready-for-review-or-draft`           |
| Settings → Spark → When checks still fail in Full auto            | `ship-and-pull-requests#when-checks-still-fail-in-full-auto` |
| Settings → Spark → Follow up on pull requests                     | `pr-follow-up`                                               |
| Settings → Models → model cards info tip                          | `providers-and-models#read-the-model-cards`                  |
| Settings → Updates → Channel                                      | `updates#stable-or-beta`                                     |
| Map → what Jev reads info tip                                     | `privacy-and-secrets#sparkignore`                            |
| Settings → Spark → Show Spark Island                              | `desktop-companion`                                          |
| Settings → Spark → Quick chat and Sessions shortcuts              | `companion-quick-chat#change-a-shortcut`                     |
| Settings → Updates → Download updates automatically               | `updates#download-updates-automatically`                     |
| Settings → Help → Send anonymous heartbeat                        | `privacy-and-secrets#anonymous-heartbeat`                    |
| Settings → Sparks                                                 | `sparks`                                                     |

Getting started links to `troubleshooting#run-setup-again` for when setup comes back.
