# Phone remote: plan

The app now calls this feature **Remote control** and what connects a **paired device**; a phone is one kind. See [REMOTE_CONTROL.md](REMOTE_CONTROL.md) for the rename and the names that stay.

Status: T1 and T2 built; T3 and T4 in part (layout pass, service worker, notifications when a chat needs you). Order chosen by the owner on 2026-10-05: Tailscale first, then a Cloudflare relay with end-to-end encryption. The same web UI runs on the phone in both.

## Goal

Use Spark Outpost from a phone while the work stays on the Mac.

- Open a chat that was started on the Mac, watch it live, send messages, answer cards.
- Start a new chat from the phone in a linked project.
- Get a notification when a chat needs you, finishes or fails.
- Go back to the Mac and find everything there, because it never left.

## Not in scope

- Running agents anywhere but the Mac. No cloud runner, no hosted database.
- The Browser pane, preview, shell tabs and starting a Terminal session on the phone. A running Terminal session is the exception: see [Terminal sessions from a paired device](#terminal-sessions-from-a-paired-device-built).
- Sharing a Mac with another person. One owner, their own devices.
- A native iPhone or Android app. It is a later step (phase 6) and reuses everything before it.

## First version: Tailscale

The phone reaches the Mac over the user's own tailnet. No relay, no hosted page, nothing for the owner to run.

```
Phone (browser, on the tailnet)  ⇄  Tailscale Serve on the Mac  ⇄  Spark server on 127.0.0.1
```

- **Reach.** The Phone page (left bar, above Settings) detects Tailscale and, when the user turns it on, runs Tailscale Serve so `https://<mac>.<tailnet>.ts.net` proxies to Spark's local port. Serve only, never Funnel: the address works only for devices on the user's tailnet. The server still listens on `127.0.0.1` alone.
- **Guards.** The Host and Origin checks accept exactly the Serve hostname Spark configured, in addition to loopback. Requests arriving that way are remote requests: the launch token is neither needed nor accepted from them, and they pass through the remote gateway below.
- **Sign-in.** Pairing as described under Design, with one difference: the device credential is a random token in a cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), stored hashed on the Mac. Tailnet membership alone grants nothing; an unpaired device sees only the pairing page.
- **UI.** The Mac serves its own web build, so the phone always runs the version the Mac runs. No loader and no transport seam; `fetch` and `EventSource` work as they are.
- **Encryption.** Tailscale's WireGuard tunnel and the Serve certificate. Spark adds none of its own in this version.
- **Notifications.** Web Push from the Mac, as under Design. The Serve address is a real HTTPS origin, so home-screen install and push work.

Shared with the relay version and built once: pairing, the device list, the remote gateway and allowlist, the switches, audit, the per-client focus flag, the phone layout pass, notifications and keep-awake.

Limits: the user installs Tailscale on the Mac and the phone and enables HTTPS certificates in their tailnet. The machine name appears in the certificate.

### Phases for the Tailscale version

| #   | What                                                                                                      | Done when                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| T1  | Done. Remote gateway: devices and pairing, cookie sessions, allowlist, switches, audit, per-client focus  | A paired fake device can read a chat and answer a card; blocked routes return 403; local traffic is unchanged |
| T2  | Done. Tailscale: detect, turn Serve on and off, accept the Serve hostname, the Phone page with the QR     | With a fake Tailscale CLI, turning it on yields an address and a QR; turning it off closes remote access      |
| T3  | Part done (manifest, service worker, layout pass, Mac-only parts hidden). Left: asleep and offline states | The full flow passes in a phone-sized browser through a local HTTPS proxy standing in for Serve               |
| T4  | Part done (needs-you notifications, guide pages). Left: finished and failed, keep-awake, real-phone test  | A card on the Mac reaches a real phone on the tailnet and is answered from it                                 |

The relay version follows and replaces only the reach, sign-in transport and encryption parts.

## Remote gateway (T1, built)

Code: `apps/server/src/remote/`. Contracts: `packages/contracts/src/remote.ts`. Storage: migration `0136_remote_access.sql`. Nothing here opens a network port or runs Tailscale; with the hostname setting empty the server behaves exactly as before.

### Which requests are remote

- The setting is `remote_access_settings.hostname`: zero or one exact DNS name, empty by default. It is read and written with `GET` and `PUT /api/remote/access` (`{ "hostname": "mac.tailnet.ts.net" }` or `null`). T2 fills it from Tailscale Serve.
- A request whose Host is `127.0.0.1:<port>` or `localhost:<port>` is local and runs the unchanged guards: allowed Origin, then the launch token.
- Any other Host is looked up against the setting. No match, or an empty setting, gets the same `403` as before. A match makes the request remote.
- A remote request must carry `Origin: https://<hostname>` when it sends one, and every write must send one. The launch token header is removed before anything else reads it, so it grants nothing.
- The terminal socket keeps its own loopback Host check and never accepts a remote Host.

### A spoofed Host on loopback

Tailscale Serve connects to `127.0.0.1`, so the server cannot tell a proxied phone from a program on the Mac that sends the Serve hostname as its Host. It does not try to. The rule is that claiming to be remote can only take powers away:

- A remote request never passes the launch-token check and never reaches a route outside the allowlist.
- Without a device cookie it gets the pairing page, the theme stylesheet, and the two pairing calls. Pairing needs a code that only a launch-token request can create and a confirmation that only a launch-token request can give.
- With a device cookie it gets what that phone gets. The cookie exists only on the phone; the Mac stores a SHA-256 hash.
- Headers a proxy adds (forwarded addresses, Tailscale identity headers) are not read, because a local program can send them too.

So a local program gains nothing it could not already do by pairing a device with the user's confirmation. It can use up the pairing rate limit for a minute, which blocks pairing and nothing else.

### Pairing

A phone that is already paired can also sign in again with a passkey; see Passkey sign-in below. That never creates a device.

1. A local request starts it: `POST /api/remote/pairings` returns a 12-character code (60 bits, shown as `XXXX-XXXX-XXXX`) valid for two minutes. A new code replaces the last. Five starts a minute.
2. The phone posts the code and a device name to `POST /api/remote/pair`. The code is burned on first use. The answer holds a one-time claim secret and a six-digit matching code. Five attempts a minute across all callers; wrong, expired and reused codes get the same `403`.
3. The Mac lists waiting requests (`GET /api/remote/pairings`: device name, matching code) and answers with `POST /api/remote/pairings/:id/confirm` or `/deny`.
4. The phone polls `POST /api/remote/pair/claim`: `202` while waiting, `403` once denied or expired, and after a confirm `200` once, with the session cookie.

The browser test stack runs the fake agent runtime and sets `PAIRING_TEST_ATTEMPTS_PER_MINUTE` so that specs sharing one server don't share the five-a-minute windows for pairing and passkey sign-in. Any other runtime ignores it.

Pairing again (the claim reads the device cookie the phone still carries; every case still needs the code, the matching code and a confirm on the Mac):

- A valid cookie (known, not revoked, seen within 30 days): the same `remote_devices` row gets the new token hash, the typed name and `last_seen_at = now()`. The old token stops working. Audit `device_paired_again`.
- A known cookie that is revoked or ran out: nothing is revived. A new row is inserted and the old one gets `replaced_by` (migration `0149_remote_device_replaced.sql`) and, if it had none, `revoked_at`. Audit `device_paired` with `replaced`.
- No cookie, or one this Mac does not know: a new row. Names are never merged, because two phones can share one. The device list marks an older row as `duplicateOf` the newest row with the same name (trimmed, any case) while the older one holds no open stream; the Phone page labels it "Not seen since" and offers **Remove old entry**, which is a revoke.
- The Devices card lists rows that can connect. Revoked and replaced rows sit behind an "N removed" toggle.

Decisions the plan left open:

- The phone polls rather than holding one request open, so a dropped mobile connection does not lose the pairing.
- Pairing state lives in memory, hashed. A restart ends any pairing in progress, which fails closed.
- The pairing page is rendered by the server with a per-response nonce and a `default-src 'none'` policy. It links `/theme.css` and uses only theme tokens. It reads a code from `#code=` so a T2 QR link can prefill it.

### Sessions and devices

- Cookie `__Host-spark_device`: 32 random bytes, `HttpOnly; Secure; SameSite=Strict; Path=/`, no Domain. Table `remote_devices` holds id, name, token hash, created, last seen (written at most once a minute) and revoked. A passkey sign-in adds a second token for the same row in `remote_device_sessions`.
- A device not seen for 30 days is refused and must pair again. The server enforces this from `last_seen_at`; the cookie's own lifetime is longer (`Max-Age` of 400 days, the most browsers keep), so closing the browser does not end the session.
- The cookie belongs to the exact Serve hostname (`__Host-`). If the Mac's tailnet name changes, the phone has no cookie for the new address, sees the pairing page and pairs as a new device; the old row stays until removed. Turning Phone access off and on, restarting or updating the app, a port change and the Serve check at start revoke nothing. Only Revoke, Disconnect all and pairing again over a revoked or run-out cookie set `revoked_at`.

### Arriving from another site or app

A browser leaves a `SameSite=Strict` cookie off a top-level navigation that another site started: a tapped link in a chat or mail app's web view, a QR scanner's page, a link on any web page, `window.open`, and a reload of a page reached that way. Measured in Chromium 153 with the cookie above: typed address, bookmark-style navigation and a redirect from a typed address carry it; a cross-site link, `target=_blank`, `window.open`, a navigation from `about:blank` or a `data:` page, a meta refresh on another site, and a cross-site link followed by a same-origin `302` do not. The gateway then saw an unpaired request and answered with the pairing page, which is how a paired phone was asked to pair again.

The cookie stays `Strict`. For a `GET` that is not under `/api`, carries no device cookie, is not marked `Sec-Fetch-Site: same-origin`, and is a document (or sends no `Sec-Fetch-Dest`), the gateway answers with a bounce page (`entry-bounce.ts`): no data, `Cache-Control: no-store`, `default-src 'none'` with one nonce'd script that calls `location.replace` on the same address plus `spark_entry=1`. That second navigation starts on our own origin, so the browser attaches the cookie. With the flag present the gateway never bounces: a paired device gets a `302` to the address without the flag (path checked so it cannot leave the origin), anything else gets the pairing page, which removes the flag from the address bar.

Why this and not `SameSite=Lax`:

- With `Lax` any site could make the phone send a cookie-bearing `GET` to any allowed `/api` route by navigating to it. With the bounce, the only thing a cross-site navigation can reach with the cookie is the web app's own HTML.
- Two allowed reads write derived rows (`GET /api/home/digest` creates the profile row, `GET /api/tickets/inbox` stores an attention snapshot). `remote-get-safety.db.test.ts` walks every allowed `GET` and fails when another one writes. They are harmless, and under `Strict` no other site can trigger them.
- Writes are unchanged: every one needs `Origin: https://<hostname>`, and a cross-site `POST` navigation carries no cookie under either setting.
- The bounce reveals nothing: it is the same for every caller and is only sent when no cookie arrived. An API call, a write or a sub-resource is never bounced.
- A phone with scripts off follows the `noscript` meta refresh to the same flag.

The app's HTML is sent to a phone with `Cache-Control: no-store`, like the pairing page, so a restored tab cannot show one in place of the other. Hashed assets keep their caching.

When the pairing page is shown, a `pairing_page_shown` audit row records why: `missing` (no cookie even after the bounce), `unknown` (a cookie this Mac has no row for), `revoked` or `unused` (with the device). At most one row a minute per reason and device; never the token.

- Local endpoints: `GET /api/remote/devices`, `PATCH /api/remote/devices/:id` (rename), `DELETE /api/remote/devices/:id` (revoke), `POST /api/remote/devices/disconnect-all`. Revoking is checked on every request and closes that device's open event streams. Clearing or changing the hostname closes every device's streams.
- `connected` in the device list is true while a device holds an event stream open. T2 uses it for the "phone connected" mark.

### Policy

`apps/server/src/remote/route-rules.ts` is the single list. Each `METHOD /path` is `always`, `never`, `pairing` (the two unauthenticated pairing calls), `passkey` (the two unauthenticated passkey sign-in calls, refused when their switch is off) or the name of a switch. Matching mirrors the router (any case, trailing slash, `HEAD` as `GET`); when two patterns fit one path every one of them must allow it; a path with no rule is refused. `apps/server/test/remote-policy.db.test.ts` walks the routes the app registers and fails when one has no rule, or a rule has no route.

Decisions the plan left open:

- **Raise agent mode or autonomy** is enforced as "change": with the switch off, a phone request to chat settings or provider defaults that carries `agentMode`, `permission` or `level` is refused. Agent modes are provider-defined and have no order to compare.
- **Answer high-risk cards** covers cards with git hooks or git config, force push, agent instruction files or a secret file in their paths, and rail flags. A card that approves a saved sign-in needs the sign-ins switch. The Browser pane's site cards are ordinary cards by the owner's decision of 2026-10-12: a paired device may answer **Let the agent open this site?**, **Let the agent read this page?**, **Let the agent click and type on this site?** and the hold-to-confirm **Send a secret value?** card with no switch, as it may answer the same hold card for a push. `cardSwitch` returns null for them and `policy.test.ts` says so; the pane itself stays on the Mac.
- **Pair another device and manage devices** is stored but opens no route: changing switches, starting or confirming pairing, device management, the hostname, Tailscale Serve and the phone audit are Mac-only, so a lost phone cannot widen its own access. It stays off and the Phone page does not show it.
- Deleting a chat and unlinking a project sit behind **Reset or delete data**. Listing folders on the Mac sits behind **Link a new folder or clone a repo**.

Decided by the owner on 2026-10-06: a phone does everything the Mac app does except the Browser pane, preview and terminal. Changed by the owner on 2026-10-14: a running Terminal session may be followed, typed into, stopped and approved from a paired device behind two switches.

- Always allowed, added: `POST /api/tasks/:id/ship`.
- Behind **Change settings**, added: trusting a folder's hooks and MCP servers (`PUT /api/projects/:id/agent-config/trust` and `/trust/redirects`) and reading that folder's agent setup.
- Behind **Add or change providers and connections**, added: the saved MCP server list and the pending GitHub and Slack sign-in state.
- Never from a phone: starting a Terminal session, shell tabs, preview routes, opening a folder in Finder, the diagnostics export, the git installer, updates and native dialogs, and `GET /api/instructions-file`. That last one reads any `.md`, `.markdown`, `.mdc` or `.txt` file on the Mac by absolute path with no project confinement, so it stays on the Mac.
- Every switch but the Mac-only one defaults on, saved sign-ins and reset included (migration `0137_phone_defaults.sql`).

Added with outposts ([A2A_CHATS.md](A2A_CHATS.md), October 9, 2026), with no new switch:

- Always allowed: `GET /api/outposts`, `GET /api/outposts/:id`, `PATCH /api/outposts/:id` (rename, pause and resume share this route), `POST /api/outposts/:id/posts` (a request or a note) and `POST /api/outposts/:id/posts/:postId/cancel`. A request posted from a phone starts a turn in the receiving chat under that chat's own mode and autonomy, as `POST /api/conversations/:id/messages` does, and a Needs you is answered through that existing route.
- Never from a phone: `POST /api/outposts` (create), `DELETE /api/outposts/:id`, and `PUT` and `DELETE /api/outposts/:id/members/:conversationId` (add a chat, change a handle, remove a chat). These stay on the Mac until the owner decides otherwise.
- Never from a phone: both A2A routes, `GET /api/a2a/chats/:chatId/.well-known/agent-card.json` and `POST /api/a2a/chats/:chatId`. A paired phone has no A2A endpoint, and a remote request never passes the launch-token check those routes need.
- Added with release 2 of outposts, always allowed: `POST /api/outposts/:id/posts/:postId/start-now` (Start anyway on a held request, like cancel) and `GET /api/conversations/:id/outpost-drafts` (the draft line under a turn; counts and ids only).
- Never from a phone: `GET /api/outposts/drafts/:id`, the draft the create sheet opens from. Starting a story through the sheet is `POST /api/outposts`, which is create and membership and stays on the Mac.
- Added when agents start sub-chats themselves ([A2A_CHATS.md](A2A_CHATS.md#17-agents-start-sub-chats-october-20-2026)), always allowed with no new switch: `POST /api/outposts/drafts/:id/start`, which starts a draft exactly as proposed (the server builds the request; nothing on it can be edited), and the agent's **Start these sub-chats?** card, which a phone answers through `POST /api/approvals/:id/decision` like other Spark action cards (`cardSwitch` returns no switch for `start_outpost`). Owner decision: both paths do only what a phone could already do one chat at a time (create a chat, send it a message), each new chat's mode is held to the lead chat's, and both use the same rule so neither is a way around the other. On a phone the draft line shows **Start** instead of "Review and start on your Mac"; **Edit** on the card and the create sheet stay on the Mac. A start from the route is a `spark/start_outpost` audit entry on the run that proposed the draft.
- Added with Pause Spark ([A2A_CHATS.md](A2A_CHATS.md#16-pause-spark-october-14-2026)), always allowed: `GET` and `PUT /api/spark-pause`. Pausing only holds work that would start by itself, so a device may pause and resume like the Mac.
- The web app does not yet hide **New outpost**, **Add to outpost**, the chat list of the edit sheet or **Hold to delete outpost** on a phone; the gateway refuses the request.

What a phone is shown differently (`apps/server/src/remote/redaction.ts`):

- `GET /api/setup` shortens a saved key's mask to its last four characters.
- `GET /api/projects/:id/file` and attaching a project file refuse paths inside `.git`.
- `GET /api/tasks/:id/changes/diff` sends no text for a secret-named file.

Known and left as it is: a phone with the settings or connections switch on sees what the Mac sees in agent setup and MCP server lists, including a credential someone typed into a command argument or URL. Project files outside the secret-name list (`.mcp.json`, `*.tfvars`) are readable as on the Mac.

Switches are `GET /api/remote/switches` (readable by a paired phone) and `PATCH /api/remote/switches` (local only), stored as columns of `remote_access_settings`. `GET /api/remote/session` tells the web app whether it runs on a phone, which device it is, the address and the switches.

### Audit

The run audit log is a per-run hash chain of agent traffic, so phone activity has its own table, `remote_audit`, pruned on the same retention setting and listed by `GET /api/remote/audit` (local only). A row is written before a remote write runs and gets the response status when it ends. Pairing start, submit, failure, confirm and deny, device paired, paired again, renamed and revoked, the pairing page shown (with the reason), disconnect all, hostname and switch changes, each notification sent (`notification_sent`, with its outcome and any refusal reason), a change of the notification sender contact and every refusal of a known device are rows too. `POST /api/slack/presence` gets no request row: a paired device reports focus every 30 seconds, it carries no data and changes nothing stored, and the rows would push pairing and revoke out of the list. Rows hold the device id and name, method and path; never a body, query string, code, claim or token.

### Focus

`POST /api/slack/presence` takes an optional `clientId`. Local windows are `local:<id>` and a phone is always `device:<device id>`, whatever it sends. Slack stays quiet while any client is focused, and one client's blur no longer clears another's focus. A paired device reports focus whether or not Slack is connected, and the push sender skips the device that is focused (see Notifications).

## Passkey sign-in (built)

Code: `apps/server/src/remote/passkey-*.ts`, `apps/web/src/phone/passkey-*.ts` and `Passkey*.tsx`. Storage: migration `0157_remote_passkeys.sql`. Library: `@simplewebauthn/server` 14.0.3, pinned.

The device cookie lives in one browser. Another browser on the same phone, or the home-screen app, has none and saw the pairing page. A passkey lets a phone that is already paired sign in again there without going back to the Mac. It never pairs a new device: pairing still starts on the Mac and is confirmed on the Mac.

### Flows

- **Save.** A paired phone (valid device cookie) asks `POST /api/remote/passkeys/options`, runs `navigator.credentials.create`, and posts the result to `POST /api/remote/passkeys`. The credential is stored against that `remote_devices` row. A device can hold several (one per passkey manager); the options list the device's credentials as excluded so one manager does not store two. `GET /api/remote/passkeys` lists this device's own.
- **Sign in.** The pairing page shows "Sign in with a passkey" when the switch is on and the browser has WebAuthn. `POST /api/remote/passkey/sign-in/options` returns a challenge with no credential list (discoverable credentials); `POST /api/remote/passkey/sign-in` verifies the assertion. On success the browser gets a new device cookie for the same device row, `last_seen_at` is set, and the page opens the app. A plain button, no autofill prompt: the page has no username field for it to attach to.
- **Remove.** On the Mac, `DELETE /api/remote/devices/:id/passkeys` removes a device's passkeys and keeps the device.

### Parameters

- RP ID is the exact Serve hostname in `remote_access_settings.hostname`; the expected origin is `https://<hostname>`. A changed hostname means no stored credential matches and the phone pairs again, as it already must for the cookie.
- Resident key required, user verification required (on create, on get, and checked in the signed flags), attestation `none`, algorithms ES256 and RS256.
- User handle: the device id's 16 bytes. An assertion whose user handle names another device is refused.

### What is stored

- `remote_passkeys`: id, workspace, device (cascade), credential id (unique), COSE public key, sign counter, transports, whether the authenticator says it is synced, a label from a short built-in AAGUID list (else none), created, last used.
- `remote_device_sessions`: token hash (unique), device (cascade), passkey (cascade), created. One row per passkey sign-in. `remote_devices.token_hash` stays the token from pairing.
- `remote_access_settings.can_passkeys`, default true: the switch.
- Challenges live in memory only (`passkey-challenges.ts`): 32 random bytes, two minutes, used once. A save challenge is bound to the device id; a sign-in challenge is bound to a random ticket in a `__Host-spark_passkey` cookie (`HttpOnly; Secure; SameSite=Strict`, two minutes) set by the options call, stored hashed. A restart drops them, which fails closed.

### Decisions

- **The old sign-in keeps working.** Pairing again rotates the token because one browser replaces its own cookie. A passkey sign-in exists for a second browser, so rotating would sign the first one out and the two would take turns. Each passkey sign-in adds a session row instead; every session resolves to the same device row, so revoke, the 30-day rule, switches and audit apply to all of them alike. Pairing again from a browser that holds a passkey session replaces that session's token, not the paired browser's.
- **Revoke removes passkeys.** Revoke, Remove old entry, being replaced by pairing again, and Disconnect all delete the device's passkeys and passkey sessions in the same statement that sets `revoked_at`. The assertion also checks the device row every time.
- **Disconnect all removes them too.** It revokes every device and promises that each must pair again; a passkey that survived would break that promise. The recommended "sessions end, passkeys remain" would need Disconnect all to stop revoking, which is a change to what it does today.
- **Removing a device's passkeys ends the sessions they started** (cascade) and closes the device's streams. The browser that paired stays signed in.
- **30 days.** A passkey sign-in counts as use. A device not seen for 30 days is refused and must pair again from the Mac, so a forgotten synced passkey cannot come back on its own.
- **Sign counter.** Synced passkeys report 0 and are accepted. A counter that does not rise, when either side is non-zero, may mean a copied authenticator: the sign-in is still allowed (the user verified, and the Mac can remove the passkey), the audit row carries `counter: "regressed"`, the Phone page says so in plain words, and the stored counter keeps the higher value.
- **One answer.** Unknown credential, wrong or reused challenge, wrong origin or RP ID, failed signature, removed or unused device: all `403` with the same sentence. The audit row has the reason.
- **Rate limit.** Five sign-in option calls and five sign-in attempts a minute across all callers, the same window class pairing uses. A local program can use it up for a minute, which blocks passkey sign-in and nothing else.

### Policy

- Rule `passkey` (the two sign-in calls): reachable without a device cookie like the two pairing calls, and refused when the switch is off.
- Switch `passkeys` (list, save options, save): need a device cookie and the switch.
- Never from a phone: `DELETE /api/remote/devices/:id/passkeys`, and the switch itself (`PATCH /api/remote/switches`).
- With the switch off the pairing page is rendered without the button.

### Audit

`device_passkey_added`, `device_passkey_sign_in` (with `counter` when it regressed), `device_passkeys_removed` (with the count), `passkey_sign_in_failed` (with the reason, and the device when the credential was known). Never a challenge, credential id, public key, ticket or token.

### Threat notes

- A passkey proves "a paired phone's passkey manager, with the user verified", not "this handset". A synced passkey works on any device signed in to the same Apple or Google account that is also on the tailnet. The Devices card shows which passkeys are synced, every sign-in is an audit row, and the switch turns the feature off.
- The origin and RP ID are checked against the Serve hostname, so a page on another site cannot use the passkey, and a local program that spoofs the Host header gains nothing: it cannot produce an assertion.
- A stolen cookie could save a passkey of its own. That adds no access the cookie did not have; revoking the device removes it.

Not verified: any real phone. Chromium's virtual authenticator stands in for Android and iPhone in the tests.

## Tailscale and the Phone page (T2, built)

Code: `apps/server/src/remote/tailscale-cli.ts` and `tailscale.ts`, `apps/web/src/phone/`. Storage: `remote_access_settings.serve_target` (migration `0137_phone_defaults.sql`).

### Tailscale Serve

- The CLI is found on the PATH, through the login shell, or at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. Every call goes through the injected command runner; tests use a fake.
- State comes from `tailscale status --json` (`BackendState`, `Self.DNSName`, `CertDomains`) and `tailscale serve status --json` (the handler for `/` on `<name>:443`, and `AllowFunnel`).
- States: not installed, not signed in, HTTPS certificates off, off, on (with the address), error (with the reason).
- On runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, reads the config back, then saves the hostname and the target. Off clears the hostname first, then runs `tailscale serve --https=443 off`, and only when the `/` handler is the one Spark added. `funnel` is never run.
- Spark refuses to turn on when another handler already serves `/` at that address, or when Funnel is on for it.
- A CLI failure turning on changes nothing. A CLI failure turning off still clears the hostname, so the gateway is closed even if the handler stays.
- Endpoints, local only: `GET /api/remote/tailscale`, `POST /api/remote/tailscale/on`, `POST /api/remote/tailscale/off`.

At server start, with a hostname saved:

| Serve shows                                    | Spark does                                                  |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Its handler on this launch's port              | Nothing                                                     |
| Its handler on the last launch's port          | Points Serve at the new port                                |
| No handler, another handler, or Funnel on      | Clears the hostname and says why on the Phone page          |
| Nothing readable (Tailscale stopped, CLI gone) | Leaves the setting; the Phone page shows the state it is in |

While running, a saved hostname whose handler no longer points at Spark shows as an error with one step: turn phone access off, then on.

### The app on a phone

The packaged app starts the server with `WEB_ROOT`, so a paired phone gets the app shell and its assets from the same server, and an unpaired one gets the pairing page and `theme.css`. Under `pnpm dev` the API has no `WEB_ROOT`: Serve would reach the API port, the pairing page would be unstyled and there would be no app after pairing. Use `pnpm desktop:dev` or a production build to try it.

### Phone page

A left-bar entry named Phone, directly above Settings, opening a full page (`apps/web/src/phone/PhonePage.tsx`, its own chunk).

- **Status**: the Tailscale state with one next step, the switch, the address, and "Phone connected".
- **Pair a phone**: a staged scene carried by Blob Scout. Asleep until phone access is on; ready; the QR (`https://<hostname>/#code=<code>`), the code and a two-minute ring, nudging in the last twenty seconds; the waiting phone with its name and matching code and Confirm and Deny; a short paired moment, after which the new device is highlighted once in the list; denied, expired and failed with one retry. Each stage is announced in a live region and focus moves to its main button. With reduced motion the poses are static.
- **Devices**: name, added, last seen, connected, passkeys (count, manager, newest date, synced); rename, revoke, remove passkeys, disconnect all; the **Allow passkey sign-in** switch.
- **What the phone can do**: the switches, and the line that the Browser pane, preview, shell tabs and starting a Terminal session stay on the Mac.
- **Recent phone activity**: from `GET /api/remote/audit`.
- Opened on a paired phone, the page is read-only apart from **Passkey** (saved passkeys and "Save a passkey for this phone"): connected, this device, what it can do, "Change these on your Mac". The app also offers the passkey once in a dismissible notice.

The server-rendered pairing page mirrors the stages (enter, waiting, paired, ended) with the same blob as inline SVG under its nonce.

Decisions the plan left open:

- QR codes come from `qrcode-generator` (MIT, no dependencies), drawn as one SVG path with a four-module quiet zone in fixed ink and paper colours (`--qr-ink`, `--qr-paper`).
- The Phone page polls: pairing requests every 1.5 seconds while on, devices and activity every 5, Tailscale every 10, none while the window is hidden.
- Browser tests use a fake `tailscale` on the test server's PATH (`tests/browser/bin/tailscale`), with its state in a file.

Not verified: a real Tailscale CLI. The flags follow Tailscale's Serve documentation as read on 2026-10-06; that `serve --https=443 off` removes only the `/` handler is from reading, not from a run.

### T3, the layout pass (built)

Done on `feat/phone-ready`. The rules live in `docs/design/RESPONSIVE.md`.

- **One phone query.** `(max-width: 640px), (max-height: 500px) and (pointer: coarse)` in CSS and in `apps/web/src/ui/breakpoints.ts`, so a phone on its side gets the phone shell and the tab-strip Settings.
- **Tab bar.** Home, Chats, Analytics, Tickets, Map and More; Docs, Phone and Settings are under More, which shows as active while one of its pages is open.
- **Mac-only parts hidden.** `useRemoteClient` (`apps/web/src/phone/use-remote-client.ts`) reads `GET /api/remote/session`. On a paired device the Terminal menu item and dock, the Browser menu item, the update mark, Full Disk Access, Export diagnostics, a project's Preview, the Browser pane section's signed-in sites, and "Open the worktree folder" are not rendered, and the clone dialog says "on your Mac". A Settings section whose switch is off is dimmed, inert and headed "Turned off for phones on your Mac".
- **Install.** `manifest.webmanifest`, 192 and 512 icons, an apple-touch-icon and `theme-color` (kept in step with the chosen theme). The gateway serves these few files to an unpaired phone too, like `theme.css`; the manifest link asks for credentials so a paired phone gets it through the cookie.
- **Viewport.** `viewport-fit=cover`, `interactive-widget=resizes-content`, a `100dvh` shell, safe-area padding, and the tab bar hidden while the keyboard is open.
- **Touch.** 44px hit areas for the shared controls and 16px inputs under `(pointer: coarse)`.

Not verified: any real iPhone or iPad. The keyboard handling, safe areas, zoom-on-focus and Add to Home Screen ran only in Chromium with touch emulation.

### Terminal sessions from a paired device (built)

Decided by the owner on 2026-10-14. Two switches, both off by default and changed only on the Mac: **Follow, type in and stop Terminal sessions** (`terminal`, `can_terminal`, migration 0172) and **Approve in Terminal sessions** (`terminalApprove`, `can_terminal_approve`).

- **Follow.** `GET /api/conversations/:id/terminal` and `GET …/terminal/transcript`. The transcript route reads the last 768 KB of the CLI's own session file on each request (`terminal/remote/read-tail.ts`) and returns the last 150 items: typed messages, replies, tool calls with their command or file, and interrupts (`transcript-items.ts`). Thinking, tool results and sub-agents are left out. A typed message or reply longer than 8,000 characters is cut and marked `clipped`, and the device ends it with "Continues on your Mac." The view also carries `workingSince`, the active run's start while the state is `working`, which the status line shows as a running clock. Consecutive tool calls fold into one collapsible row ("3 steps: …"). Nothing is stored and nothing is logged. The device refetches on the `/api/events` change stream (`conversation`, `run` and `step` events for that chat) and polls every 10 seconds as a fallback, 30 while the session is stopped.
- **Type.** `POST …/terminal/message` writes the message into the pane as one bracketed paste with control characters removed, then Enter 400 ms later, through the same `send-keys -H` path the Mac view uses. It is refused while the agent waits for permission or an answer, while an approval is open, and while a capture of the pane shows a menu footer (`esc to cancel` or `esc to go back`), since a paste and Enter in Codex's approval menu approves it. The same checks run again just before Enter; if a menu opened during the paste, Enter is not sent and the message stays typed on the Mac. A message that starts with `/` or `!` is refused: in Claude `!` runs a shell command and `/` opens a command. A message typed on the Mac and not yet sent would be sent with it, joined with no space. While the agent works, the device offers the chat's **Queue message** and **Send now** choice (the busy-Enter setting picks the default). Queue is the plain paste and Enter, which the CLI takes mid-turn. Send now (`{ text, now: true }`) runs every refusal above first, then sends Esc only while the state is `working`, waits until no answer or menu shows (up to ten 400 ms checks), and then sends the message through the same paste, recheck and Enter. In Claude, a message queued earlier starts as its own turn after Esc and Send now's message waits behind it.
- **Type, through the Claude mod.** In a Claude session whose Spark mod has checked in within 5 s ([NATIVE_TERMINALS.md](NATIVE_TERMINALS.md#the-spark-mod-claude)), Queue message goes to the mod's next inbox poll instead and Claude Code submits it once idle, so nothing is typed into the pane, a menu cannot be answered by it and a draft on the Mac is left alone. Send now still takes the paste path above. The message has the same control characters removed as a paste. The intent checks stay: a message that starts with `/` or `!` is refused, and so is one while an approval is open or the agent waits for permission or for an answer to its question, since the user means to answer it and a queued message would run after it. A menu footer on screen no longer refuses it. The same answer checks run again when the poll hands the message out; if one applies by then, the message is dropped from the queue and the device is told it was not sent. The request waits up to 3 s for the mod to take the message, then withdraws it and takes the paste path above with all its checks.
- **Stop.** `POST …/terminal/interrupt` sends Esc, only while the session's state is `working`: Esc twice at Claude's idle prompt opens its rewind picker. A remote `POST /api/runs/:id/cancel` of a run in a Terminal chat is refused, judged from the stored chat so it also holds while the session is still starting, so a phone cannot end the session.
- **Approve.** `POST …/terminal/approval` with the open approval's id; a different or answered id is `409`. A denial may carry `reason` (trimmed, at most 500 characters). Claude: the host answers the hook with `{ behavior: 'deny', message }` and the hook script prints that message as the denial the agent reads; a blank, overlong or missing message, or a session whose older hook script ignores the field, keeps "Denied from a paired device." Codex: Esc as before, then the reason goes through the message path once the menu is gone; a reason starting with `/` or `!` is refused before Esc, as is one while **Follow, type in and stop Terminal sessions** is off, and if the CLI has not returned to its prompt after ten checks the device is told the denial went through and the reason was not sent. Claude's `PermissionRequest` hook (its own group, timeout 600 s) asks the hook host at `/permission` and waits up to 590 s, a limit written into the hook script while Claude shows its own menu on the Mac; the first answer wins, and an answer on the Mac ends the hook, which drops the request; another tool finishing does not, only the turn ending does. Codex hides its menu while a hook runs, so its hook asks with a 2 s limit, the host answers at once, and a phone's answer is Codex's own key (`y`, or Esc, which also stops the turn), sent only after a capture of the pane shows the approval footer and that request's command or file. Without tmux there is no capture, and the answer is refused. The request's tool input goes to the hook host only and is kept in memory while the approval is open.
- **Older sessions.** A session started before this has no permission address in its `observer.json`, so its hook never asks; a re-adopted session keeps the address only if its old `observer.json` had one. The device shows the waiting state and says to answer on the Mac.
- Each message, Stop and approval is in the remote audit by method and path, never its body; reading the transcript is not audited.

Verified against Claude Code 2.1.294 and Codex CLI 0.153.4: multi-line pastes and messages sent during a turn submit in both; Claude's hook allow, deny, timeout and Mac-first answers behave as above; Codex `y` approves and Esc denies. The Claude mod was checked against Claude Code 2.1.294 in tmux: `claude plugin validate` passes, `/plugin` shows `1 mod active`, messages sent while idle and during a turn were submitted (the second after the turn ended) with `UserPromptSubmit` firing for each, the band and the approval lines showed, and after the hook host restarted on a new port with a new token the mod checked in again within a second.

Send now and the Codex denial reason were verified against Claude Code 2.1.294 and Codex CLI 0.162.1 (gpt-6-astra, `-a on-request`) in tmux, with the server's byte sequences and 400 ms gaps:

- Both CLIs stop the turn on Esc and take the pasted message as a fresh prompt (a new `UserPromptSubmit` turn id).
- Text typed on the Mac and not yet sent stays in the input after Esc, in both CLIs, and the paste joins it with no space (`draftStop counting…`), as for any message.
- A message queued earlier with **Queue message**: Codex has already put it into the running turn, so Esc stops both and Send now's message runs alone. Claude keeps it queued, starts it as its own turn right after Esc, and queues Send now's message behind it, so that message waits for the queued one to finish. Claude's hook ids lag in this case: the queued message's `UserPromptSubmit` carries the running turn's id, and Send now's message carries the id of the queued turn, so Spark records Send now's message as the run the queued turn's `Stop` closes, and the turn that answers it has no run. The same lag applies to any message queued in Claude and then interrupted, not only Send now.
- Codex Esc in its approval menu closes the menu (the footer goes back to `? for shortcuts`), fires the `Interrupt` hook within the first 400 ms check, writes `turn_aborted` to the rollout, and returns to its prompt; the reason then goes in as the next prompt. The hook payload and both screens are kept as regression tests in `native-hooks.test.ts` and `native-remote.test.ts`.

The Claude denial message is covered by the hook script test, not by a real Claude run.

### Notifications (built)

Code: `apps/server/src/remote/push-*.ts`, `apps/web/public/sw.js`, `apps/web/src/phone/PhoneNotifications.tsx`, `PushContact.tsx`, `use-device-push.ts`, `push-browser.ts`, `use-notification-chats.ts`. Storage: migrations `0174_remote_push.sql` and `0176_remote_push_contact.sql`. Library: `web-push` 3.6.7 (MPL-2.0), pinned.

- **Switch.** **Notify when a chat needs you** (`notifications`, `can_notifications`), off by default and changed only on the Mac. Without it the Mac sends nothing and a device cannot subscribe; a device can always unsubscribe.
- **Keys.** One VAPID key pair per install, made the first time a device asks for it and kept as one keychain entry (`remote:push:vapid`). One holder behind a single in-flight promise; a value the keychain returns that does not parse is replaced.
- **Subscriptions.** `remote_push_subscriptions`: device (cascade), endpoint (unique), the browser's `p256dh` and `auth`, the Serve hostname and the public key it was made under. Revoke, Remove old entry, being replaced by pairing again and Disconnect all delete a device's rows in the statement that sets `revoked_at`. A row made under another hostname or key is never sent to. A device keeps its newest five rows; older ones are deleted when it subscribes again.
- **Endpoint check.** The endpoint is an address the device chose and the Mac posts to, so `PUT /api/remote/push/subscription` takes only `https` on port 443 at `fcm.googleapis.com`, `android.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com` or `*.notify.windows.com`, with no user or password. The sender checks again.
- **Routes.** `GET /api/remote/push` (the public key and this device's endpoints) and `DELETE /api/remote/push/subscription` are always allowed; `PUT /api/remote/push/subscription` needs the switch. All three answer `404` without a device, so the Mac has no use for them.
- **What is sent.** One notification per chat after an 8-second wait, for approval cards created since the server started and for a Terminal session entering `waiting_for_permission` or `waiting_for_input`, once per wait. Before sending, the Mac checks the card is still pending or the session still waiting, and drops it when the chat was seen (`seen_at`, set by the Mac or a device while the chat is viewed, focused and visible) at or after the card appeared, so a chat the user is looking at, or opened during the wait, is never pushed for that card; a summary's `waitingSince` is the newest pending card, so a second card after a look counts again. The payload is `{ title, body, chatId, tag }`: the chat title (redacted, 80 characters; a chat that read Slack direct messages gets Slack's fixed title), a fixed line per card kind as Slack uses ("Needs your approval", "Has a question for you", "Waiting for permission in the terminal"), the chat id and a tag that replaces the chat's older notification. Never a command, path, project or card title. A Terminal-session push does not need the `terminal` switch: it says only that the session waits.
- **Who gets it.** Every device with a subscription that is not revoked, was seen in 30 days, and is not the focused client (`device:<id>` in the shared focus list; the web app now reports focus on a paired device even without Slack). Focus has one owner, created in `main.ts` and shared with the Slack notifier.
- **Sending.** `web-push` with TTL one hour, urgency high and a 15-second socket timeout, signed with the sender contact below. Devices are sent to in parallel. `404` and `410` delete the row. Each send is a `notification_sent` audit row with its outcome and, for a refusal, the push service's HTTP status and its `reason` code (letters only, such as Apple's `BadJwtToken`), never the content, the endpoint or the response body.
- **Sender contact.** Every push carries a VAPID JWT whose `sub` must be a `mailto:` or `https:` contact ([RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292)). Apple's documented `BadJwtToken` causes include a subject that "isn't a URL or `mailto:`", and in practice Apple also answers `403 BadJwtToken` to a contact on a name with no public domain (`@localhost`, `.local`), while Chrome and Firefox accept it, so a placeholder fails only on iPhone and Safari. The default is therefore the project page `https://github.com/karki011/spark-outpost`, the same for every install and accepted the way other `https://github.com/…` subjects are (Apple appears to check the name's form, not fetch it; not verified on a device). **Sender contact** under the switch on the Mac (`GET`/`PUT /api/remote/push/contact`, Mac-only in `route-rules.ts`, `push_contact` on `remote_access_settings`) takes the user's own email (stored as `mailto:`) or an `https://` address; it refuses IPs, single-label names, reserved and private names (`.invalid`, `.local`, `.localhost`, `.test`, `.example`, `.internal`, `.lan`, `.home.arpa` and similar), the Serve hostname and any `*.ts.net` name, so the tailnet name never reaches Apple or Google; the sender checks again and falls back to the default. Changing it needs no new subscription: only the key is tied to one. The card lists each device whose latest notification since the contact last changed failed, with its reason; `BadJwtToken` says the push service did not accept the sender contact. Changing the contact is a `push_contact_changed` audit row that says only whether one is set.
- **Service worker.** `sw.js` is served to a paired device and, like the icons, to an unpaired one. It shows every push it gets (iOS ends a subscription that receives pushes without a notification), so all quieting happens on the Mac. A tap focuses an open window and posts `spark-open-chat`, or opens `/?chat=<id>`; the app checks the id is a UUID and opens the chat. When the app is visible it closes its shown notifications (`getNotifications`) for the chat on screen and for chats with nothing unseen, so one seen on the Mac goes when the device next opens Spark. A push already shown can't be recalled sooner: a silent push to close it isn't allowed on iOS. Not verified on a device. It has no `fetch` handler. The app registers it only when `GET /api/remote/session` says remote, never in Electron.
- **On the device.** Remote control → **Notifications** → **Notify this device**. The public key and the active registration (`navigator.serviceWorker.ready`) are loaded first, and the tap calls `pushManager.subscribe` before anything else, so the browser still sees the gesture; it asks for permission. A `NotAllowedError` says notifications were not allowed; any other failure says try again. A browser that reports no `applicationServerKey` on its subscription is taken at its word, since the Mac already filters by key. Without Push support the card says what iPhone needs or that the browser cannot. On iPhone push works only in the Home Screen app, which has no device cookie, so the order is: pair in Safari, save a passkey, add to the Home Screen, open it and sign in with the passkey, then turn on **Notify this device**. Blocked permission and the switch being off on the Mac are said in words.

What reaches Apple, Google or Mozilla: an encrypted payload (RFC 8291), its size and time, the VAPID public key and the sender contact (the project page unless the user set their own). They cannot read the title or the line.

Not verified: any real iPhone or Android delivery. Tests use a fake sender and a stubbed `PushManager`; the endpoint list, Apple's acceptance of the default subject and iOS behaviour come from documentation and other projects' reports, not a run. A refusal now shows on the Mac instead of passing silently.

### What is left for the phone app

- A local HTTPS proxy standing in for Serve, so a phone-sized browser runs the whole flow with the real cookie.
- An offline cache in the service worker (it has no `fetch` handler, so nothing works offline).
- "Your Mac is asleep or offline" states with the last-seen time.
- A real-device check of the keyboard, safe areas and the home-screen app.
- Controls outside Settings that a switch turns off (linking a folder, deleting a chat, raising the agent mode, high-risk cards) still show; the server refuses them with the "Turned off for phones on your Mac" message.
- Show more than one waiting pairing request at a time; the scene shows the oldest.

## How the relay version fits together

```
Phone (web app)  ⇄  Relay (Cloudflare Worker)  ⇄  Mac (Spark server)
        └────── end-to-end encrypted ──────┘
```

- **Mac.** The Spark server opens one outbound WebSocket to the relay while phone access is on. It never listens on anything but `127.0.0.1`, exactly as today.
- **Relay.** A Worker with one Durable Object per paired Mac. It joins the Mac's socket to its phones' sockets and forwards frames. It stores nothing and cannot read frames.
- **Phone.** The existing React app, served as static files from a Spark-owned HTTPS address, installed to the home screen. Its API client talks through the encrypted socket instead of `fetch` to `/api`.

Nothing on the Mac is reachable from the internet. Both sides dial out.

## What exists today

Found in the code review on 2026-10-05.

In place:

- The UI runs in a plain browser; every `window.sparkDesktop` use degrades.
- Run streams resume from the database by sequence number; a dropped stream never cancels a run.
- Two clients on one chat are safe: idempotent sends, `409` on a card answered twice, server-side countdowns.
- One endpoint answers every card (`POST /api/approvals/:id/decision`).
- A phone layout at 640px and below.

Missing:

- The server accepts only loopback Host and Origin (`apps/server/src/api/security.ts`) and only the launch token, which a phone cannot send.
- The launch token unlocks everything: terminal, folder listing, reset, provider keys.
- No way to notify a phone.
- "Quiet when focused" is one process-wide flag (`apps/server/src/slack/notifier.ts`), so two clients fight over it.
- No web app manifest or service worker. (The manifest was added in T3.)

## Design

### Pairing

1. On the Mac: Phone → Pair a phone. Spark shows a QR code for two minutes.
2. The QR holds the phone page address, the Mac's public key, a room id and a one-time pairing secret.
3. The phone opens the page, creates its own key pair, and connects through the relay.
4. The Mac shows "Pair <device name>?" with a short matching code. The user confirms on the Mac.
5. The Mac stores the device (name, public key, added, last seen). The pairing secret is burned.

Rules:

- Pairing always starts on the Mac and is confirmed on the Mac.
- A device credential is a key pair, never the launch token. The launch token never leaves the Mac.
- The device list shows last seen and has Revoke and Disconnect all. Revoking takes effect at once.
- Devices unused for 30 days need to pair again.

### Encryption

- The Mac's private key lives in the keychain. The phone's private key is a non-extractable WebCrypto key in IndexedDB.
- Each connection runs a handshake that proves both static keys and derives fresh session keys. Frames are sealed with an AEAD and a counter, so the relay cannot read, change, replay or reorder them.
- Use a reviewed Noise implementation or libsodium. No hand-rolled protocol. The choice is made in a phase 2 spike and recorded here.
- The relay sees IP addresses, timing and frame sizes. Nothing else.

### Tunnel

- A frame is a request (`id`, method, path, body), a response, a stream event, or a stream close.
- On the Mac, a remote gateway hands each request to the existing Express app in-process, with a `device` principal in place of the launch token. No second API.
- Run events and the app event feed travel as stream frames with the same sequence numbers, so resume works as it does over SSE.
- Uploads from the phone are chunked frames with the existing size limits.
- In the web app, one transport seam: `fetch` and `EventSource` on the Mac, the encrypted socket on the phone. Feature code does not change.

### What a phone may do

Default deny. A route is reachable from a phone only if it is on the remote allowlist, and some groups are behind switches.

Always allowed: read chats, plans, diffs, Work panel, Links, tickets, Docs; answer ordinary cards; send, queue and stop; Continue from here; start a chat in a linked project; open a pull request.

Never from a phone: starting a Terminal session, shell tabs, Browser pane, preview, updates, island settings, native dialogs, Finder actions, the diagnostics export, the git installer, reading an instructions file by absolute path, and everything that manages phone access: Tailscale Serve, pairing, devices, the phone audit and the switches themselves.

Switches on the Phone page, changeable only on the Mac:

| Phone can…                                                   | Default             |
| ------------------------------------------------------------ | ------------------- |
| Change settings (and trust a folder's hooks and MCP servers) | On                  |
| Add or change providers and connections                      | On                  |
| Link a new folder or clone a repo                            | On                  |
| Raise agent mode or autonomy                                 | On                  |
| Answer high-risk cards (git hooks, git config, secret files) | On                  |
| Add, change and approve saved sign-ins                       | On                  |
| Reset or delete data                                         | On                  |
| Pair another device and manage devices                       | Mac only, not shown |
| Notify when a chat needs you                                 | Off                 |

The defaults were decided by the owner on 2026-10-06.

Every remote request is audited with the device id. The Mac shows a "phone connected" mark while a device is online.

### Notifications

- Web Push sent by the Mac itself with keys generated per install and kept in the keychain. No push server.
- Sent for: a card needs you (built, see [Notifications](#notifications-built)); a run finished and a run failed are not built yet. Content is minimal by default (chat title and card type); the payload is encrypted to the device by the Web Push standard.
- iPhone needs iOS 16.4 or later and the app added to the home screen. Android Chrome works without that step.
- The focus flag becomes per client, so a phone in focus quiets the phone, not Slack for everyone.

### Phone page and versions

- The phone page is the web app build, hosted per release at `/v/<version>/`. A tiny loader at the root connects, learns the Mac's version, and loads the matching build. A Mac on an older release keeps working.
- Whoever controls that address controls the code the phone runs. It gets the same care as the signing certificate: owner-only deploys, strict CSP, no third-party scripts, fonts bundled.

### Keeping the Mac awake

While phone access is on and a run is active or a phone is connected, Spark holds a power assertion. A closed lid on battery still sleeps the Mac; the phone then shows "Your Mac is asleep or offline" with the last-seen time.

## Phases for the relay version

Each phase ends with something testable. Phases 1 and 2 need no deployment.

| #   | What                                                                                                   | Done when                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Remote gateway on the Mac: devices table, pairing, allowlist, switches, audit, per-client focus flag   | A fake device over an in-process channel can read a chat and answer a card; blocked routes return 403; all audited  |
| 2   | Encrypted channel and tunnel; transport seam in the web app                                            | Two processes talk through a local fake relay; tampered, replayed and reordered frames are rejected; streams resume |
| 3   | The relay Worker and its tests (local Workers runtime)                                                 | Mac and phone pair through it locally; rate limits and room squatting are covered                                   |
| 4   | Phone web app: manifest, service worker, layout pass, Mac-only parts hidden, offline and asleep states | The full flow passes in a phone-sized browser against the local relay                                               |
| 5   | Notifications and keep-awake; guide pages; owner deploys relay and page; first real-phone test         | A card on the Mac reaches a real phone and is answered from it, away from home Wi-Fi                                |
| 6   | Later: native shell (same UI) for stronger iPhone notifications                                        | Decided after real use of phase 5                                                                                   |

## Tests that must exist

- Pairing: expired, reused and wrong secrets fail; confirm on the Mac is required; revoke cuts a live connection.
- Crypto: a relay that reads, edits, replays, drops or reorders frames learns nothing and breaks nothing silently.
- Policy: every route is either on the allowlist or refused; a test fails when a new route is added without a decision.
- Switches: each one off blocks its routes; none can be changed from a remote device.
- Multi-client: Mac and phone on one chat; a card answered on one closes on the other.
- Recovery: phone reconnects mid-run and resumes from its last sequence number; Mac restarts and the phone reconnects.
- Existing rules: the loopback and launch-token guards are unchanged for local traffic.

## What the owner does

- Choose the address for the phone page and relay.
- Deploy the Worker and the page to their Cloudflare account, from commands Spark's docs provide. Spark's agents do not sign in or deploy.
- Say go before any release that turns this on.

## Relay address

The relay and phone page addresses are a setting, not a constant. A user can deploy the Worker and page to their own Cloudflare account and point Spark at them; the QR carries the addresses, so the phone needs no setup. Because frames are opaque and encrypted, the relay is replaceable: another transport that forwards frames between two parties (an MQTT broker, for example) could sit behind the same seam later. Only the WebSocket relay is planned.

## Cost

At small scale the relay fits Cloudflare's free tier or the $5 a month plan; idle connections cost nothing with WebSocket hibernation. The exact free allowance was not confirmed in research and should be checked before launch. The relay is rate-limited per paired Mac so one install cannot run up the bill.

## Documents to update when this starts

- `docs/product/PLAN.md`: mobile clients move out of "deferred".
- `AGENTS.md`: one paragraph on the remote gateway, like the Browser pane's.
- `docs/architecture/ELECTRON_PLAN.md`: threat model gains the remote device principal.
- Guide: a Phone access page, the Settings reference, and "what leaves the computer" (the relay sees addresses, timing and sizes; notifications pass through Apple or Google encrypted).

## Open decisions

1. Are the proposed switch defaults right? (Decided 2026-10-06: all on; managing devices stays on the Mac.)
2. Which address hosts the phone page and relay?
3. Is there also a default relay on the owner's account, or does every user deploy their own? (Decided 2026-10-05: users can point Spark at their own relay.)
4. Lowest iOS version to support (16.4 is the floor for notifications).
5. Should a Slack notification link open the phone app once paired?
