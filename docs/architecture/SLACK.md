# Slack

Spark Outpost is a local app: Slack cannot reach it, and it ships no Slack client secret. There are two ways to connect, one at a time per workspace:

- **Sign in with Slack** (`method` `sign_in`): OAuth with PKCE against one Slack app that whoever builds Spark owns. The user approves in their browser; Spark gets a user token only. Shown when the build has a Slack client ID. See [Sign in with Slack](#sign-in-with-slack).
- **Use your own Slack app** (`method` `own_app`, the advanced option): the user creates a Slack app from a manifest Spark provides, installs it in their workspace and pastes its tokens into Settings → Connectors → Slack. Sections below describe this method unless they say otherwise.

Everything runs on the user's Mac against `https://slack.com/api` (or `SLACK_API_URL` in tests).

Code: `apps/server/src/slack/` (sign-in in `sign-in.ts`, `oauth.ts`, `user-token.ts`, `sign-in-config.ts`), routes in `apps/server/src/api/slack-routes.ts`, rows in `apps/server/src/persistence/slack.ts` and `slack-sign-in.ts` (migrations 0119, 0120 and 0125), contracts and the manifest in `packages/contracts/src/slack.ts`, Spark tools in `apps/server/src/spark-mcp/tools/slack-tool.ts` and `actions/slack-actions.ts`, UI in `apps/web/src/slack/`, the desktop hand-over in `apps/desktop/src/slack-sign-in.ts`.

## Sign in with Slack

### Set up the Slack app (once, by the person who builds Spark)

Spark cannot create the app for you. On api.slack.com/apps:

1. **Create New App → From scratch**. Any name (users see it on the consent screen), any development workspace.
2. **OAuth & Permissions → Redirect URLs**: add `spark-outpost://slack/callback`, and `spark-outpost-dev://slack/callback` if you run the dev channel packaged. Save.
3. **OAuth & Permissions → PKCE**: turn it on. This marks the app as a public client and is one-way: Slack support has to undo it. In a manifest it is `"pkce_enabled": true`.
4. **OAuth & Permissions → User Token Scopes**: add the scopes in the table below, including the four direct message scopes. Add no bot scopes: Slack refuses bot scopes on a desktop redirect.
5. **Manage Distribution → Activate Public Distribution**, so people in other workspaces can sign in. Without it only your own workspace can.
6. **Basic Information**: copy the **Client ID** (digits, a dot, digits). Do not copy the client secret or signing secret; Spark has no place for them.

No Socket Mode, event subscriptions, interactivity, bot user or app-level token. Those belong to the own-app method.

### Give Spark the client ID

The client ID is public. Set it in one of two places, as for the GitHub App:

- For a packaged build: the constant `SLACK_CLIENT_ID` in `apps/desktop/scripts/builder-config.ts` (empty today), or `SPARK_SLACK_CLIENT_ID` in the environment of `pnpm desktop:package`. Packaging writes it into the app's `package.json` as `slackApp.clientId` and the desktop shell hands it to the API and worker. A value that is not a client ID fails the build.
- For `pnpm dev` and `pnpm desktop:dev`: `SPARK_SLACK_CLIENT_ID` on the running processes (for example in `.local/credentials.env`).

With an empty client ID the sign-in option is hidden, its routes answer 400, and the own-app flow is unchanged. Nothing in the code accepts a Slack client secret.

### Redirect

The redirect is the app's own URL scheme, `<linkScheme>://slack/callback`, not a loopback port:

- Slack requires the PKCE arguments on a custom-scheme redirect, so a code cannot be redeemed without the verifier, and it always issues rotating tokens for it.
- The scheme is already registered by the packaged app and handled in one place (`open-url` / `second-instance` in `apps/desktop/src/main.ts`).
- A loopback redirect would need an unauthenticated route on the local API (every request carries the launch token today) and a port Slack knows in advance; Slack's docs show `http://localhost:8080/auth` and do not say other ports match.

The desktop shell does not read the link. It posts the whole URL to `POST /api/slack/sign-in/callback` with the launch token; `parseSlackCallbackLink` accepts only that scheme, host and path, and `code`, `state` and `error` values made of URL-safe characters. An unpackaged run (`pnpm dev`, `pnpm desktop:dev`) does not register the scheme, so the redirect has nowhere to land there; tests post the callback themselves.

### Flow

1. `POST /api/slack/sign-in` (`directMessages`, `replace`) creates a `state` (32 random bytes) and a PKCE verifier (48 random bytes) with its S256 challenge, keeps them in the API process for 10 minutes, and returns `https://slack.com/oauth/v2/authorize?client_id&user_scope&redirect_uri&state&code_challenge&code_challenge_method=S256`. The address is built from a constant and accepted by the client schema only on `https://slack.com`. Only one sign-in waits at a time; starting again replaces it.
2. The web app opens the address in the default browser and keeps an **Open Slack again** link. `GET /api/slack/sign-in` reports `idle`, `waiting`, `connected` or `failed` with a message; `DELETE` cancels. The flow, with its address, stays out of `GET /api/slack`, so agent tools never see it.
3. The callback is checked against the waiting `state` in constant time. A wrong, missing or already-used `state` is refused (400) without touching the waiting sign-in and without calling Slack. A matching one is consumed before the exchange.
4. `oauth.v2.access` is called with `client_id`, `code`, `code_verifier` and `redirect_uri`: no `client_secret`, no `Authorization` header. The answer must carry `authed_user.access_token` of type `user`; a bot token is never read or stored.
5. `auth.test` with the new token gives the team, the member and (from `x-oauth-scopes`) the scopes; its `user_id` must be the `authed_user.id` of the exchange.
6. Access token, refresh token and both expiry times are one JSON entry in the keychain (`slack:sign-in:token`). `slack_connections` gets `method`, `state`, `generation`, `access_expires_at`, `refresh_expires_at`, the team, the member and `user_scopes`; `bot_user_id` and `bot_name` are empty. No column holds a token.

| Ending                            | What the user reads                                                              |
| --------------------------------- | -------------------------------------------------------------------------------- |
| **Cancel** in Spark               | Nothing; the button is back. A late callback is refused                          |
| Denied in Slack (`access_denied`) | "The sign-in was cancelled in Slack."                                            |
| No callback within 10 minutes     | "Slack didn't send you back in time…", naming admin approval as the likely cause |
| Wrong or replayed `state`         | "That Slack sign-in link doesn't match a sign-in Spark is waiting for…"          |
| Code refused (`invalid_code`)     | "Slack refused that sign-in code. It may have been used already or run out."     |
| Other `error` on the redirect     | "Slack ended the sign-in (code)…", again naming admin approval                   |
| PKCE off or wrong client ID       | "Slack doesn't accept this build's client ID for sign-in…"                       |

A workspace that makes an admin approve apps shows the user a request screen and, as far as the docs say, no redirect, so Spark sees a timeout; the message says to sign in again once the app is approved.

### Refresh

- The access token lasts 12 hours. `slackSignInToken` refreshes five minutes before expiry, and `slackAnswer` refreshes once and retries when a call answers `invalid_auth`, `token_expired`, `token_revoked`, `not_authed` or `account_inactive`.
- The refresh is `oauth.v2.access` with `grant_type=refresh_token`, `refresh_token` and `client_id`: no secret and no PKCE arguments.
- One refresh runs at a time: a per-process promise plus a Postgres advisory lock (`slack-sign-in:<workspace>`) across the API and worker. Inside the lock the keychain is re-read; a caller that held the old token after another process refreshed gets the new one without a second refresh. `generation` tells the other process to re-read its cached copy.
- Slack retires the old refresh token as soon as it is redeemed. The new pair is written to the keychain as one entry before the row's `generation` and expiry times move. If the keychain write fails, the next refresh is refused and the connection needs sign-in.
- When Slack refuses the refresh token (any `ok: false` that is not a rate limit or a Slack-side fault), or the keychain entry is gone, the row becomes `needs_sign_in` and a `refresh` event with the reason is recorded. Settings shows **Sign in again** in place of the sections, the card loses its Connected badge, every capability reports false, and readers, posts and tools answer "Your Slack sign-in ended. Sign in again in Settings → Connectors → Slack." A rate limit or network failure changes nothing.
- `refresh_expires_at` is Spark's own estimate (30 days from the last refresh); Slack does not send one. It is never used to refuse a refresh.

### Scopes asked at sign-in

User scopes only (`SLACK_SIGN_IN_SCOPES`):

| Scope                                | Why                                                                  |
| ------------------------------------ | -------------------------------------------------------------------- |
| `channels:history`, `groups:history` | Read a thread the user shares from a public or private channel       |
| `channels:read`, `groups:read`       | The allow-list picker; tell a channel from a group message by its ID |
| `users:read`                         | Author names in a thread, names in the direct message picker         |
| `chat:write`                         | Posts the user confirms, and the notification message to themselves  |
| `search:read`                        | `spark_slack` search, filtered afterwards to what the user allowed   |

`im:read`, `im:history`, `mpim:read` and `mpim:history` are asked only when the user selects **Allow direct messages in Slack** (a second trip through the same flow with `directMessages: true`; Slack adds scopes to the ones already granted). Until then `directMessages.blockedBy` is `scopes`, exactly as for an own-app user token installed before 0120. **Sign in again** asks for them when the switch is already on.

### What each method can do

| Feature                               | Own app                                              | Sign in with Slack                                                                                         |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Read a shared thread                  | Bot token, user token for channels it has not joined | As the user                                                                                                |
| Channel picker, allow-list            | Yes                                                  | Yes; the same rows survive a switch within one workspace                                                   |
| Search                                | Needs the user token                                 | Yes                                                                                                        |
| Direct messages                       | User token with the four scopes, switch on           | Same rules, after **Allow direct messages in Slack**                                                       |
| Post an update                        | As the app; follows `actionPath`                     | As the user, always after the confirm card ("Post this to Slack as you?", **Posts as: You**) in every mode |
| Post in a one-to-one direct message   | Never                                                | Never                                                                                                      |
| Notify                                | Direct message from the bot, or a chosen channel     | `chat.postMessage` to the user's own ID: a message from them to themselves. No channel, no other member    |
| Start work from a link in the app     | Yes                                                  | Yes                                                                                                        |
| Start work from Slack (Socket Mode)   | Needs the app-level token                            | No: no bot, no app-level token. The UI and `spark_slack` say it needs your own Slack app                   |
| Reply in the thread a chat started in | Yes                                                  | No, skipped as `needs_own_app`, also for chats started before a switch                                     |
| `app_mention`, message shortcut       | Yes                                                  | No                                                                                                         |

`OpenSlack.main` is the bot client for an own app and the user client for a sign-in; `user` is the user client or null. The notify target for a sign-in is always the member (`slackNotifyTarget`), and `PATCH /api/slack/settings` refuses a member ID or a notification channel under it.

### Switching and disconnecting

- Signing in while an own app is connected needs `replace: true` (the UI asks first: "Switch and sign in"); without it the start answers 409. The own-app tokens stay in the keychain until the sign-in succeeds, then all three are deleted. An abandoned sign-in changes nothing.
- Saving own-app tokens while signed in needs `replace: true` on `PUT /api/slack/connection` (the form says what happens and its button reads "Save and switch"). On success Spark calls `auth.revoke` with the sign-in's access token and deletes the keychain entry.
- The allow-lists and settings are kept when the workspace is the same and dropped when it differs.
- **Disconnect** calls `auth.revoke` for a sign-in (best effort), deletes every Slack keychain entry and the rows. Removing the app's authorization entirely is done in Slack.
- Upgrade: 0125 adds the columns with `method` `own_app` and `state` `connected`, so an existing connection reads and behaves as before. Without a client ID nothing new is shown.

## Manifest

`SLACK_APP_MANIFEST` in `packages/contracts/src/slack.ts` is the single source; **Copy manifest** copies it as JSON. It enables Socket Mode, interactivity, the `app_mention` bot event, one message shortcut (`callback_id` `spark_start_work`, "Start work in Spark") and a read-only Messages tab so notifications have somewhere to land. No redirect URLs, slash commands or request URLs.

## Tokens

| Token     | Prefix  | Keychain account   | Required | Used for                                                                                                                                                        |
| --------- | ------- | ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot       | `xoxb-` | `slack:bot:token`  | yes      | Notifications, reading threads in channels the app joined, posting, names                                                                                       |
| User      | `xoxp-` | `slack:user:token` | no       | `search.messages`, threads and channel list for channels the app has not joined, the installing user's ID (who to notify), and direct messages the user allowed |
| App-level | `xapp-` | `slack:app:token`  | no       | `apps.connections.open` for Socket Mode                                                                                                                         |

Tokens are validated before anything is saved: `auth.test` for bot and user (the bot token must carry a `bot_id`; both must be the same team), `apps.connections.open` for the app-level token. They live only in the keychain (`SecretStore`), are never returned by a route or tool, and are covered by `redactText` (`xoxb-`, `xoxp-`, `xapp-`, and the rotating `xoxe.xoxp-` and `xoxe-` of a sign-in). Reset and Disconnect delete all of them. Without a user token the user gives their member ID in Settings, checked with `users.info`.

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

User scopes:

| Scope                                | Why                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `search:read`                        | Search, filtered afterwards to allowed channels and direct messages                 |
| `channels:history`, `groups:history` | Threads in channels the app has not joined                                          |
| `channels:read`, `groups:read`       | Full channel list in the picker                                                     |
| `im:read`                            | List the user's one-to-one direct messages in the picker; tell a `D…` link's person |
| `im:history`                         | Read a one-to-one direct message the user allowed                                   |
| `mpim:read`                          | List group direct messages in the picker; tell a group message apart from a channel |
| `mpim:history`                       | Read a group direct message the user allowed                                        |

The four direct message scopes are on the user token because the app is not a member of the user's direct messages: Spark reads them as the user. The bot token gets no `im:*` or `mpim:*` scope; its notification to the user needs only `chat:write`. App-level scope: `connections:write` (Socket Mode).

Slack returns a token's scopes in the `x-oauth-scopes` header of every Web API answer. Spark stores the user token's scopes from `auth.test` when the tokens are saved (`slack_connections.user_scopes`), fills them in once for a connection saved before 0120, and re-reads them on **Check again** (`POST /api/slack/scopes/check`). `directMessages.blockedBy` in the status is `user_token` when no user token is saved and `scopes` when any of the four is missing; Settings then shows **Update the Slack app to allow direct messages** with the steps (copy the updated manifest, paste it under App Manifest, save, reinstall, paste a new user token if Slack issued one, check again).

## Allow-list

`slack_channels` holds the channels the user ticked, each with an optional project. Reading a thread, searching, posting and starting work all call `requireAllowedChannel` first; a channel that is not allowed raises `SlackChannelNotAllowedError`, which the API answers as 409 with `code: slack_channel_not_allowed` and the channel so the UI can offer **Allow this channel**. Search results outside the allow-list are dropped and only counted.

## Direct messages

Off by default. `settings.readDirectMessages` is the **Let Spark read my direct messages** switch; it can be turned on only with a user token that carries the four scopes. `slack_direct_conversations` holds the one-to-one (`im`) and group (`mpim`) conversations the user ticked, named after the other person (`users.info`) or the group's members. `settings.allDirectMessages` is the separate **All my direct messages** choice. Turning the switch off deletes the list and clears "all".

`requireSlackPlace` (`access.ts`) decides every read and post target: an allowed channel, else a direct message. A `D…` id is refused without a Slack call while the switch is off; other ids are looked up with `conversations.info`, so a group message can never enter the channel allow-list (`toChannel` rejects `is_im` and `is_mpim`). A direct message that is not allowed raises `SlackChannelNotAllowedError` with `kind` `im` or `mpim` and no name; the UI offers **Allow this conversation** (`POST /api/slack/direct-messages/:id/allow`). Direct messages are read with the user token only.

| Rule              | Detail                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading           | Same caps, redaction and untrusted note as channels. The `read` event records the conversation id and `kind`, never text or names                                                      |
| Search            | Matches in allowed direct messages are kept; others are dropped and counted. With "all", unlisted ones are labelled "a direct message"                                                 |
| `channels` action | Lists allowed direct messages under `directMessages`; never calls `conversations.list`, so no other name reaches the agent                                                             |
| Posting           | Never in a one-to-one message. An allowed group message the app was added to always gets the confirm card, in every mode (`proposeAction` with `alwaysAsk`)                            |
| Start work        | From the app by link as for channels. From Slack, only the connected member can trigger in a direct message, and Spark never replies there                                             |
| Notifications     | A chat that read a direct message (`slack_direct_chats`, or a context item with `kind` `im`/`mpim`) is announced as "A chat that read your Slack direct messages" instead of its title |
| Attachment names  | "Slack direct message.md" or "Slack group message.md", so a title made from the file name holds no person's name                                                                       |

## Capabilities

### Notify

`startSlackNotifier` runs in the API process and observes the same `changes` notifications as the app event feed. For a changed chat it reads candidates created after it started: pending approvals (`needs_you`), the latest top-level run when it succeeded or failed, `pr_watches` rows (`pr_opened`) and open `rail_flags` (`flag`). Each candidate is claimed once in `slack_deliveries` (unique key), so restarts and repeated events never send twice.

`notifyDecision` then skips an event that is switched off, has no target, or arrives while the Spark window is focused (the web app posts `/api/slack/presence`; focus expires after 45 seconds without a heartbeat). The rest wait in a per-chat batch for 20 seconds and go out as one message: chat title (escaped, redacted, 80 characters), project, one fixed line per kind of event with a count, and a `spark-outpost://chat/<id>` link (`spark-outpost-dev://` in the dev channel; the packaged app registers the scheme and `parseSparkChatLink` accepts nothing but a chat id). Approvals answered during the wait are dropped. Commands, paths, diffs, plan text and question text are never included. The target is the chosen channel, else a direct message to the member ID.

A failed delivery is logged without tokens, recorded on the delivery row and shown as **Last problem** in Settings. The notifier never touches runs.

### Read

`readSlackThread` takes a message link, checks the allow-list, calls `conversations.replies` with the bot token and falls back to the user token for `not_in_channel` or `channel_not_found` (an allowed direct message goes straight to the user token). It resolves author names, turns Slack markup into plain text, redacts secrets and caps the result at 100 messages and 12,000 characters.

- Pasting a link in the message box calls `POST /api/slack/context`, which stores the thread as a text attachment headed by the untrusted-data note and records it in `slack_context_items`. A run in a chat that has such an attachment records the `private_data` observation "Slack messages (a shared thread)".
- `spark_slack` (`thread`, `search`, `channels`) is a private read tool: every result carries the untrusted note and the call records a `private_data` observation. `search` needs the user token and says so when it is missing.

### Post

`spark_slack_post` builds a `post_slack` Spark action (channel, optional thread, text). It follows `actionPath` like every Spark action:

| Situation                                                                           | Result                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| A direct or group message, or a post as you (signed in with your own Slack account) | Confirm card in every mode                      |
| Auto, Bypass permissions, Approve for me or Full access                             | Posted at once                                  |
| Accept edits and the message asked to post to Slack                                 | Posted at once                                  |
| Anything else                                                                       | Confirm card with the channel and editable text |

The text is redacted when the card is built and again when sent, `&`, `<` and `>` are escaped so mentions and links in agent text cannot ping anyone, and posts to one channel are spaced 1.1 seconds apart. HTTP 429 is retried after `Retry-After` (up to twice, 30 seconds at most). `not_in_channel` tells the user to `/invite` the app. Each post writes a `slack_events` row and the usual `spark/post_slack` audit entry.

### Start work

`startFromSlack` reads the thread, creates a chat (project: the one chosen, else the channel's), attaches the thread and sends a short brief that marks it as untrusted. The run uses the user's default agent mode and autonomy; a trigger cannot widen them.

- In the app: **Start work from a Slack link** (`POST /api/slack/start`).
- From Slack: `startSlackSocket` opens Socket Mode when an app-level token is saved and the setting is on, acks every envelope and handles the shortcut and `app_mention`. Only the connected member or an allowed member ID may trigger; one thread starts one chat (`start:<channel>:<thread>` in `slack_deliveries`); every trigger, refused or not, is a `slack_events` row. Refusals are silent in Slack.

With **Reply in the thread** on, chats started from Slack itself get fixed replies there: "Started in Spark.", then finished, failed or the pull request link. Chats started from a link in the app never auto-post.

## Data handling

| Data                                                                      | Stored                                                                  | Sent                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tokens                                                                    | Keychain only                                                           | To Slack, as the bearer token                                                         |
| Sign-in `state` and PKCE verifier                                         | API process memory, 10 minutes, used once                               | `state` and the challenge in the browser address; the verifier to Slack with the code |
| Slack client ID                                                           | Build manifest or environment                                           | To Slack                                                                              |
| Workspace, bot and member names, allow-lists, settings, user token scopes | `slack_connections`, `slack_channels`, `slack_direct_conversations`     | Nowhere                                                                               |
| Thread text                                                               | Only as the attachment of the chat that asked for it                    | To the chat's AI provider, as an attachment                                           |
| Search results, `spark_slack` output                                      | Not stored by Slack code; the agent transcript holds what the agent saw | To the chat's AI provider                                                             |
| Notifications                                                             | Dedupe key, kind and outcome; never text                                | Chat title, project, event lines and link, to Slack                                   |
| Posts                                                                     | Channel, length and outcome; the card keeps the redacted text           | The confirmed text, to Slack                                                          |

Jev receives nothing Slack-specific. A chat started from Slack sends Jev the same short, redacted facts about the request as any chat; the brief names the channel and link, not the thread text.

## Tests

`apps/server/test/fake-slack.ts` fakes the Web API, `fake-slack-oauth.ts` the authorize step, `oauth.v2.access` (code exchange with the S256 check, refresh with rotation) and `auth.revoke`, and `slack-support.ts` adds a Socket Mode WebSocket server. Browser specs route `https://slack.com` to a stub, so no test talks to Slack.

Not verifiable for sign-in without a real Slack app and workspace (none exists yet): that Slack accepts a refresh with no client secret (the PKCE page shows it; the token rotation page still lists the secret as required); the exact refresh answer for a user token (both the flat and the `authed_user` shape are accepted); that `spark-outpost://slack/callback` is accepted as a Redirect URL and that public distribution can be activated with only custom-scheme redirects (the distribution page asks for SSL on redirect URLs and does not mention PKCE); what the redirect carries on denial and under admin approval; that `chat.postMessage` to the user's own ID lands in their own space and whether Slack alerts them about it; that `auth.revoke` on a rotating access token also ends the refresh token; the 30-day refresh lifetime in practice; the macOS hand-over of the link from a real browser to the packaged app.

Not verifiable for the own app without a real workspace: that Slack accepts the manifest as written, that a custom URL scheme renders as a link in Slack clients, direct messages addressed by member ID, real rate-limit behaviour, that reinstalling keeps or replaces the user token, the exact `x-oauth-scopes` header, the shape of `conversations.list` and `search.messages` results for direct messages, and group message ids that start with `C`.
