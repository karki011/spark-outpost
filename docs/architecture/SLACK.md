# Slack

Spark Outpost is a local app: Slack cannot reach it, and it ships no Slack client secret. The user creates their own Slack app from a manifest Spark provides, installs it in their workspace and pastes its tokens into Settings → Connectors → Slack. Everything below runs on the user's Mac against `https://slack.com/api` (or `SLACK_API_URL` in tests).

Code: `apps/server/src/slack/`, routes in `apps/server/src/api/slack-routes.ts`, rows in `apps/server/src/persistence/slack.ts` (migration 0119), contracts and the manifest in `packages/contracts/src/slack.ts`, Spark tools in `apps/server/src/spark-mcp/tools/slack-tool.ts` and `actions/slack-actions.ts`, UI in `apps/web/src/slack/`.

## Manifest

`SLACK_APP_MANIFEST` in `packages/contracts/src/slack.ts` is the single source; **Copy manifest** copies it as JSON. It enables Socket Mode, interactivity, the `app_mention` bot event, one message shortcut (`callback_id` `spark_start_work`, "Start work in Spark") and a read-only Messages tab so notifications have somewhere to land. No redirect URLs, slash commands or request URLs.

## Tokens

| Token     | Prefix  | Keychain account   | Required | Used for                                                                                                                      |
| --------- | ------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Bot       | `xoxb-` | `slack:bot:token`  | yes      | Notifications, reading threads in channels the app joined, posting, names                                                     |
| User      | `xoxp-` | `slack:user:token` | no       | `search.messages`, threads and channel list for channels the app has not joined, and the installing user's ID (who to notify) |
| App-level | `xapp-` | `slack:app:token`  | no       | `apps.connections.open` for Socket Mode                                                                                       |

Tokens are validated before anything is saved: `auth.test` for bot and user (the bot token must carry a `bot_id`; both must be the same team), `apps.connections.open` for the app-level token. They live only in the keychain (`SecretStore`), are never returned by a route or tool, and are covered by `redactText` (`xoxb-`, `xoxp-`, `xapp-`). Reset and Disconnect delete all three. Without a user token the user gives their member ID in Settings, checked with `users.info`.

## Scopes

Bot scopes:

| Scope                                | Why                                              |
| ------------------------------------ | ------------------------------------------------ |
| `chat:write`                         | Send notifications and post confirmed updates    |
| `channels:read`, `groups:read`       | List channels for the allow-list picker          |
| `channels:history`, `groups:history` | Read a shared thread in a channel the app is in  |
| `users:read`                         | Author names in a thread; validate the member ID |
| `app_mentions:read`                  | Receive `app_mention` over Socket Mode           |
| `commands`                           | Offer the message shortcut                       |

User scopes: `search:read` (search), `channels:history`, `groups:history` (threads in channels the app has not joined), `channels:read`, `groups:read` (full channel list). App-level scope: `connections:write` (Socket Mode).

No `im:*` or `mpim:*` scope is requested: Spark cannot read direct messages, and refuses `D…` links before calling Slack.

## Allow-list

`slack_channels` holds the channels the user ticked, each with an optional project. Reading a thread, searching, posting and starting work all call `requireAllowedChannel` first; a channel that is not allowed raises `SlackChannelNotAllowedError`, which the API answers as 409 with `code: slack_channel_not_allowed` and the channel so the UI can offer **Allow this channel**. Search results outside the allow-list are dropped and only counted.

## Capabilities

### Notify

`startSlackNotifier` runs in the API process and observes the same `changes` notifications as the app event feed. For a changed chat it reads candidates created after it started: pending approvals (`needs_you`), the latest top-level run when it succeeded or failed, `pr_watches` rows (`pr_opened`) and open `rail_flags` (`flag`). Each candidate is claimed once in `slack_deliveries` (unique key), so restarts and repeated events never send twice.

`notifyDecision` then skips an event that is switched off, has no target, or arrives while the Spark window is focused (the web app posts `/api/slack/presence`; focus expires after 45 seconds without a heartbeat). The rest wait in a per-chat batch for 20 seconds and go out as one message: chat title (escaped, redacted, 80 characters), project, one fixed line per kind of event with a count, and a `spark-outpost://chat/<id>` link (`spark-outpost-dev://` in the dev channel; the packaged app registers the scheme and `parseSparkChatLink` accepts nothing but a chat id). Approvals answered during the wait are dropped. Commands, paths, diffs, plan text and question text are never included. The target is the chosen channel, else a direct message to the member ID.

A failed delivery is logged without tokens, recorded on the delivery row and shown as **Last problem** in Settings. The notifier never touches runs.

### Read

`readSlackThread` takes a message link, checks the allow-list, calls `conversations.replies` with the bot token and falls back to the user token for `not_in_channel` or `channel_not_found`. It resolves author names, turns Slack markup into plain text, redacts secrets and caps the result at 100 messages and 12,000 characters.

- Pasting a link in the message box calls `POST /api/slack/context`, which stores the thread as a text attachment headed by the untrusted-data note and records it in `slack_context_items`. A run in a chat that has such an attachment records the `private_data` observation "Slack messages (a shared thread)".
- `spark_slack` (`thread`, `search`, `channels`) is a private read tool: every result carries the untrusted note and the call records a `private_data` observation. `search` needs the user token and says so when it is missing.

### Post

`spark_slack_post` builds a `post_slack` Spark action (channel, optional thread, text). It follows `actionPath` like every Spark action:

| Situation                                                                | Result                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| The run read secrets or private data (including Slack)                   | Confirm card                                    |
| Auto, Bypass permissions, Approve for me, Full access, or Full auto → PR | Posted at once                                  |
| Accept edits and the message asked to post to Slack                      | Posted at once                                  |
| Anything else                                                            | Confirm card with the channel and editable text |

The text is redacted when the card is built and again when sent, `&`, `<` and `>` are escaped so mentions and links in agent text cannot ping anyone, and posts to one channel are spaced 1.1 seconds apart. HTTP 429 is retried after `Retry-After` (up to twice, 30 seconds at most). `not_in_channel` tells the user to `/invite` the app. Each post writes a `slack_events` row and the usual `spark/post_slack` audit entry.

### Start work

`startFromSlack` reads the thread, creates a chat (project: the one chosen, else the channel's), attaches the thread and sends a short brief that marks it as untrusted. The run uses the user's default agent mode and autonomy; a trigger cannot widen them.

- In the app: **Start work from a Slack link** (`POST /api/slack/start`).
- From Slack: `startSlackSocket` opens Socket Mode when an app-level token is saved and the setting is on, acks every envelope and handles the shortcut and `app_mention`. Only the connected member or an allowed member ID may trigger; one thread starts one chat (`start:<channel>:<thread>` in `slack_deliveries`); every trigger, refused or not, is a `slack_events` row. Refusals are silent in Slack.

With **Reply in the thread** on, chats started from Slack itself get fixed replies there: "Started in Spark.", then finished, failed or the pull request link. Chats started from a link in the app never auto-post.

## Data handling

| Data                                                  | Stored                                                                  | Sent                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| Tokens                                                | Keychain only                                                           | To Slack, as the bearer token                       |
| Workspace, bot and member names, allow-list, settings | `slack_connections`, `slack_channels`                                   | Nowhere                                             |
| Thread text                                           | Only as the attachment of the chat that asked for it                    | To the chat's AI provider, as an attachment         |
| Search results, `spark_slack` output                  | Not stored by Slack code; the agent transcript holds what the agent saw | To the chat's AI provider                           |
| Notifications                                         | Dedupe key, kind and outcome; never text                                | Chat title, project, event lines and link, to Slack |
| Posts                                                 | Channel, length and outcome; the card keeps the redacted text           | The confirmed text, to Slack                        |

Jev receives nothing Slack-specific. A chat started from Slack sends Jev the same short, redacted facts about the request as any chat; the brief names the channel and link, not the thread text.

## Tests

`apps/server/test/fake-slack.ts` fakes the Web API and `slack-support.ts` adds a Socket Mode WebSocket server. No test talks to Slack. Not verifiable without a real workspace: that Slack accepts the manifest as written, that a custom URL scheme renders as a link in Slack clients, direct messages addressed by member ID, and real rate-limit behaviour.
