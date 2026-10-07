# Phone remote: plan

Status: T1 and T2 built. Order chosen by the owner on 2026-10-05: Tailscale first, then a Cloudflare relay with end-to-end encryption. The same web UI runs on the phone in both.

## Goal

Use Spark Outpost from a phone while the work stays on the Mac.

- Open a chat that was started on the Mac, watch it live, send messages, answer cards.
- Start a new chat from the phone in a linked project.
- Get a notification when a chat needs you, finishes or fails.
- Go back to the Mac and find everything there, because it never left.

## Not in scope

- Running agents anywhere but the Mac. No cloud runner, no hosted database.
- The Browser pane, preview and terminal on the phone.
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

| #   | What                                                                                                     | Done when                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| T1  | Done. Remote gateway: devices and pairing, cookie sessions, allowlist, switches, audit, per-client focus | A paired fake device can read a chat and answer a card; blocked routes return 403; local traffic is unchanged |
| T2  | Done. Tailscale: detect, turn Serve on and off, accept the Serve hostname, the Phone page with the QR    | With a fake Tailscale CLI, turning it on yields an address and a QR; turning it off closes remote access      |
| T3  | Phone web app: manifest, service worker, layout pass, Mac-only parts hidden, asleep and offline states   | The full flow passes in a phone-sized browser through a local HTTPS proxy standing in for Serve               |
| T4  | Notifications, keep-awake, guide pages, first real-phone test by the owner                               | A card on the Mac reaches a real phone on the tailnet and is answered from it                                 |

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

1. A local request starts it: `POST /api/remote/pairings` returns a 12-character code (60 bits, shown as `XXXX-XXXX-XXXX`) valid for two minutes. A new code replaces the last. Five starts a minute.
2. The phone posts the code and a device name to `POST /api/remote/pair`. The code is burned on first use. The answer holds a one-time claim secret and a six-digit matching code. Five attempts a minute across all callers; wrong, expired and reused codes get the same `403`.
3. The Mac lists waiting requests (`GET /api/remote/pairings`: device name, matching code) and answers with `POST /api/remote/pairings/:id/confirm` or `/deny`.
4. The phone polls `POST /api/remote/pair/claim`: `202` while waiting, `403` once denied or expired, and after a confirm `200` once, with the session cookie.

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

- Cookie `__Host-spark_device`: 32 random bytes, `HttpOnly; Secure; SameSite=Strict; Path=/`, no Domain. Table `remote_devices` holds id, name, token hash, created, last seen (written at most once a minute) and revoked.
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

`apps/server/src/remote/route-rules.ts` is the single list. Each `METHOD /path` is `always`, `never`, `pairing` (the two unauthenticated pairing calls) or the name of a switch. Matching mirrors the router (any case, trailing slash, `HEAD` as `GET`); when two patterns fit one path every one of them must allow it; a path with no rule is refused. `apps/server/test/remote-policy.db.test.ts` walks the routes the app registers and fails when one has no rule, or a rule has no route.

Decisions the plan left open:

- **Raise agent mode or autonomy** is enforced as "change": with the switch off, a phone request to chat settings or provider defaults that carries `agentMode`, `permission` or `level` is refused. Agent modes are provider-defined and have no order to compare.
- **Answer high-risk cards** covers cards with git hooks or git config, force push, agent instruction files or a secret file in their paths, and rail flags. A card that approves a saved sign-in needs the sign-ins switch.
- **Pair another device and manage devices** is stored but opens no route: changing switches, starting or confirming pairing, device management, the hostname, Tailscale Serve and the phone audit are Mac-only, so a lost phone cannot widen its own access. It stays off and the Phone page does not show it.
- Deleting a chat and unlinking a project sit behind **Reset or delete data**. Listing folders on the Mac sits behind **Link a new folder or clone a repo**.

Decided by the owner on 2026-10-06: a phone does everything the Mac app does except the Browser pane, preview and terminal.

- Always allowed, added: `POST /api/tasks/:id/ship`.
- Behind **Change settings**, added: trusting a folder's hooks and MCP servers (`PUT /api/projects/:id/agent-config/trust` and `/trust/redirects`) and reading that folder's agent setup.
- Behind **Add or change providers and connections**, added: the saved MCP server list and the pending GitHub and Slack sign-in state.
- Never from a phone: terminal, preview routes, opening a folder in Finder, the diagnostics export, the git installer, updates and native dialogs, and `GET /api/instructions-file`. That last one reads any `.md`, `.markdown`, `.mdc` or `.txt` file on the Mac by absolute path with no project confinement, so it stays on the Mac.
- Every switch but the Mac-only one defaults on, saved sign-ins and reset included (migration `0137_phone_defaults.sql`).

What a phone is shown differently (`apps/server/src/remote/redaction.ts`):

- `GET /api/setup` shortens a saved key's mask to its last four characters.
- `GET /api/projects/:id/file` and attaching a project file refuse paths inside `.git`.
- `GET /api/tasks/:id/changes/diff` sends no text for a secret-named file.

Known and left as it is: a phone with the settings or connections switch on sees what the Mac sees in agent setup and MCP server lists, including a credential someone typed into a command argument or URL. Project files outside the secret-name list (`.mcp.json`, `*.tfvars`) are readable as on the Mac.

Switches are `GET /api/remote/switches` (readable by a paired phone) and `PATCH /api/remote/switches` (local only), stored as columns of `remote_access_settings`. `GET /api/remote/session` tells the web app whether it runs on a phone, which device it is, the address and the switches.

### Audit

The run audit log is a per-run hash chain of agent traffic, so phone activity has its own table, `remote_audit`, pruned on the same retention setting and listed by `GET /api/remote/audit` (local only). A row is written before a remote write runs and gets the response status when it ends. Pairing start, submit, failure, confirm and deny, device paired, paired again, renamed and revoked, the pairing page shown (with the reason), disconnect all, hostname and switch changes, and every refusal of a known device are rows too. Rows hold the device id and name, method and path; never a body, query string, code, claim or token.

### Focus

`POST /api/slack/presence` takes an optional `clientId`. Local windows are `local:<id>` and a phone is always `device:<device id>`, whatever it sends. Slack stays quiet while any client is focused, and one client's blur no longer clears another's focus. T4 can read the focused clients to quiet a phone's own notifications.

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
- **Devices**: name, added, last seen, connected; rename, revoke, disconnect all.
- **What the phone can do**: the switches, and the line that the Browser pane, preview and terminal stay on the Mac.
- **Recent phone activity**: from `GET /api/remote/audit`.
- Opened on a paired phone, the page is read-only: connected, this device, what it can do, "Change these on your Mac".

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
- **Mac-only parts hidden.** `useRemoteClient` (`apps/web/src/phone/use-remote-client.ts`) reads `GET /api/remote/session`. On a paired device the Terminal button and dock, the Browser button, the update mark, Full Disk Access, Export diagnostics, a project's Preview and "Keep sign-ins in the browser", and "Open the worktree folder" are not rendered, and the clone dialog says "on your Mac". A Settings section whose switch is off is dimmed, inert and headed "Turned off for phones on your Mac".
- **Install.** `manifest.webmanifest`, 192 and 512 icons, an apple-touch-icon and `theme-color` (kept in step with the chosen theme). The gateway serves these few files to an unpaired phone too, like `theme.css`; the manifest link asks for credentials so a paired phone gets it through the cookie.
- **Viewport.** `viewport-fit=cover`, `interactive-widget=resizes-content`, a `100dvh` shell, safe-area padding, and the tab bar hidden while the keyboard is open.
- **Touch.** 44px hit areas for the shared controls and 16px inputs under `(pointer: coarse)`.

Not verified: any real iPhone or iPad. The keyboard handling, safe areas, zoom-on-focus and Add to Home Screen ran only in Chromium with touch emulation.

### What is left for the phone app

- A local HTTPS proxy standing in for Serve, so a phone-sized browser runs the whole flow with the real cookie.
- A service worker (none yet, so nothing works offline and there is no install prompt on Android).
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

Never from a phone: terminal, Browser pane, preview, updates, island settings, native dialogs, Finder actions, the diagnostics export, the git installer, reading an instructions file by absolute path, and everything that manages phone access: Tailscale Serve, pairing, devices, the phone audit and the switches themselves.

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

The defaults were decided by the owner on 2026-10-06.

Every remote request is audited with the device id. The Mac shows a "phone connected" mark while a device is online.

### Notifications

- Web Push sent by the Mac itself with keys generated per install and kept in the keychain. No push server.
- Sent for: a card needs you, a run finished, a run failed. Content is minimal by default (chat title and card type); the payload is encrypted to the device by the Web Push standard.
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
