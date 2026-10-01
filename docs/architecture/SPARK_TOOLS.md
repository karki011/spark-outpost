# Spark tools coverage

Every agent session (Ask, Do, Builders, chats without a project) gets the `spark` MCP server from `apps/server/src/spark-mcp/`. Goal: an agent can answer any question about Spark through these tools. This table maps each user-facing area to the tool that answers it. Tool code lives in `spark-mcp/tools/`; `spark_guide` section `spark-tools` is the agent-facing version of this table and a test keeps it naming every read tool.

## Rules every tool follows

- Grants are per turn: a bearer token scoped to one workspace, chat and run, revoked when the turn ends. Every query filters by that workspace.
- Results pass through `renderResult`: secrets and tokens are redacted, long text and lists are clipped, and paging is explicit.
- Tools marked private record a `private_data` run observation, so the read-then-send guard (`approvals/egress.ts`, `taint.ts`) asks before that run sends data out.
- Tools never return file contents, terminal output, secrets or API keys.
- Read tools change nothing. Actions only propose: each one shows a `spark_action` confirm card and runs after the user confirms.

## Coverage

| Area (web / API)                                                                           | Tool                                                    | Private | Notes                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Home: needs feed, pending cards                                                            | `spark_attention`                                       | yes     | Every waiting card across chats with who asks, how long and the choices; failed chats; flagged tickets |
| Home: today so far, spend card (`/home/today`, `/usage/spend`)                             | `spark_spend`, `spark_activity`                         | yes     | Today or this week, by provider (with Jev), model and chat                                             |
| Home: morning brief (`/home/digest`)                                                       | `spark_brief`                                           | yes     | Reads the latest brief; never writes one                                                               |
| Chats list, search, state                                                                  | `spark_chats`                                           | yes     |                                                                                                        |
| One chat: messages, runs, approvals, settings                                              | `spark_chat`                                            | yes     | Also the chat's branch and worktree                                                                    |
| Chat history: earlier turns, compactions and their summaries                               | `spark_chat_history`                                    | yes     | Turn range or search over the full transcript, including turns compacted out of the agent's context    |
| Live run: phase, crew, pieces, checkpoints, budget (`/runs/:id/orchestration`)             | `spark_run`                                             | yes     | Crew members with model, status, cost, who picked them and why                                         |
| Jev decisions: intake, routing, `piece_route`, clarify, verify                             | `spark_run` (`jevDecisions`)                            | yes     | Per-piece pick, decidedBy, reason, Jev's and the rules' picks; clarify rounds                          |
| Plans: plan versions, agreed plan document, checklist (`/tasks/:id`)                       | `spark_task`                                            | yes     | Current version, approval, files changed since agreed                                                  |
| Files changed, keep and revert (`/tasks/:id/changes`)                                      | `spark_task`                                            | yes     | Paths, change kind, line counts, reverted runs; never contents                                         |
| Ship and PRs (`/tasks/:id/ship`, GitHub)                                                   | `spark_task` (links), `spark_pull_requests`, `spark_pr` | no      | Open a PR (ready or draft per settings): `spark_open_pr` (confirm card)                                |
| PR follow-up: checks, review feedback, triage, rounds (`/conversations/:id/pull-requests`) | `spark_pr_follow_up`                                    | yes     | Another round: `spark_pr_follow_up_round` (confirm card); excerpts are untrusted GitHub text           |
| Audit: steps, declined actions, approvals, per-run cost (`/audit/*`)                       | `spark_audit`                                           | yes     |                                                                                                        |
| Recent activity                                                                            | `spark_activity`                                        | yes     |                                                                                                        |
| Analytics: overview, spend, harness                                                        | `spark_analytics`                                       | no      | Last N days                                                                                            |
| Outcomes and feedback (`/analytics/outcomes`)                                              | `spark_analytics` report `outcomes`                     | no      | Good, bad, mixed, thumbs, kept, reverted, committed, corrections; grouped; never feedback comments     |
| Usage and costs by provider and model (`/usage/summary`)                                   | `spark_spend`, `spark_analytics` report `spend`         | yes/no  |                                                                                                        |
| Model cards (`/model-cards`)                                                               | `spark_models`                                          | no      | Price, context, speed, efforts, strengths, offered or default, measured pass rates                     |
| Providers, agents, advisors, provider health                                               | `spark_providers`                                       | no      | Keys never shown                                                                                       |
| Connectors: GitHub, Jira, Linear, MCP servers                                              | `spark_connectors`                                      | no      | Tokens never shown                                                                                     |
| Settings: Spark autonomy, defaults, brief, caps, ticket attention                          | `spark_settings`                                        | no      |                                                                                                        |
| Projects: Builders at once, where Spark works, worktrees count                             | `spark_projects`                                        | no      |                                                                                                        |
| Map: areas and categories                                                                  | `spark_map`                                             | no      |                                                                                                        |
| Map: file neighbors and what breaks if a file changes (`/projects/:id/map/neighbors`)      | `spark_map` with `file`                                 | no      | Imports, imported by, 1 or 2 hops, dependent files and core areas                                      |
| Terminal sessions                                                                          | `spark_terminals`                                       | yes     | Name, folder, chat, opened, busy and the program name; never output                                    |
| Tickets inbox, attention                                                                   | `spark_tickets`                                         | yes     | Actions: create, comment, transition, assign (confirm cards)                                           |
| How Spark works                                                                            | `spark_guide`                                           | no      | Section `spark-tools` maps questions to tools                                                          |

## Gaps

- Onboarding progress and the setup checklist (`/setup`): providers and connectors are covered; there is no single "what is left to set up" answer.
- Repo agent config and trust (`/projects/:id/agent-config`): which repo instructions, skills and MCP servers reach agents is not readable.
- Status companion (desktop): its preferences live in the web app only.
- Git state of a project (`/projects/:id/git`, branches): only the default branch and live worktree count are exposed.
- Ship preview (`/tasks/:id/ship`: what a commit or PR would include and why it is blocked) is not exposed; it runs git and GitHub calls.
- Feedback comments and reasons are not shared; only counts (thumbs up and down) per group.
- No new actions: steering pieces, answering cards, keep or revert, cancel and ship stay in the UI. Any future action must use the `spark_action` confirm card. `spark_pr_follow_up_round` only queues items and lets the follow-up worker start the round; the push and GitHub replies still go through their own card (or Full auto).

## Terminal sessions

Terminals live in the API process and Spark tools run in the worker, so the API records each open chat shell in `terminal_shells` (migration 0083: id, workspace, chat, label, folder, pid) when it attaches and removes it when it ends; startup clears the table. `spark_terminals` skips rows whose process is gone and reads the running program from the process table.

## PR follow-up

`spark_pr_follow_up` reads `pr_watches` and `pr_feedback_items` (migration 0087) for the chat's PRs or a PR number: phase, what Spark is doing, checks, rounds used of 3, and each item with author, write access, triage (Jev or rules) and state. Item excerpts come from GitHub reviewers and CI and are marked as data. `spark_pr_follow_up_round` shows a `pr_follow_up_round` card listing the items; on confirm it queues them (including held items from people without write access, or items past the round limit) and asks the worker to start a round. See `PR_FOLLOW_UP.md`.

## Chat history and compaction

`spark_chat_history` reads `messages` for one chat (this chat by default) as numbered turns, by range (`from`, `to`) or by a case-insensitive search, and lists the chat's `compactions` (migration 0088): method (`agent`, `spark`, `agent-auto`), tokens before and after, and the summary. A compacted session's preamble and the note after an agent's `/compact` tell the agent the tool exists. Compaction itself has no action tool: the card or the autonomy level decides. See `COMPACTION.md`.
