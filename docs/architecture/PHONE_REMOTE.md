# Phone remote: plan

Status: plan. Order chosen by the owner on 2026-10-05: Tailscale first, then a Cloudflare relay with end-to-end encryption. The same web UI runs on the phone in both.

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

- **Reach.** Settings → Phone access detects Tailscale and, when the user turns it on, runs Tailscale Serve so `https://<mac>.<tailnet>.ts.net` proxies to Spark's local port. Serve only, never Funnel: the address works only for devices on the user's tailnet. The server still listens on `127.0.0.1` alone.
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
| T2  | Tailscale: detect, turn Serve on and off, accept the Serve hostname, Settings → Phone access with the QR | With a fake Tailscale CLI, turning it on yields an address and a QR; turning it off closes remote access      |
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

Decisions the plan left open:

- The phone polls rather than holding one request open, so a dropped mobile connection does not lose the pairing.
- Pairing state lives in memory, hashed. A restart ends any pairing in progress, which fails closed.
- The pairing page is rendered by the server with a per-response nonce and a `default-src 'none'` policy. It links `/theme.css` and uses only theme tokens. It reads a code from `#code=` so a T2 QR link can prefill it.

### Sessions and devices

- Cookie `__Host-spark_device`: 32 random bytes, `HttpOnly; Secure; SameSite=Strict; Path=/`, no Domain. Table `remote_devices` holds id, name, token hash, created, last seen (written at most once a minute) and revoked.
- A device not seen for 30 days is refused and must pair again. The server enforces this from `last_seen_at`; the cookie's own lifetime is longer.
- Local endpoints: `GET /api/remote/devices`, `PATCH /api/remote/devices/:id` (rename), `DELETE /api/remote/devices/:id` (revoke), `POST /api/remote/devices/disconnect-all`. Revoking is checked on every request and closes that device's open event streams. Clearing or changing the hostname closes every device's streams.
- `connected` in the device list is true while a device holds an event stream open. T2 uses it for the "phone connected" mark.

### Policy

`apps/server/src/remote/route-rules.ts` is the single list. Each `METHOD /path` is `always`, `never`, `pairing` (the two unauthenticated pairing calls) or the name of a switch. Matching mirrors the router (any case, trailing slash, `HEAD` as `GET`); when two patterns fit one path every one of them must allow it; a path with no rule is refused. `apps/server/test/remote-policy.db.test.ts` walks the routes the app registers and fails when one has no rule, or a rule has no route.

Decisions the plan left open:

- **Raise agent mode or autonomy** is enforced as "change": with the switch off, a phone request to chat settings or provider defaults that carries `agentMode`, `permission` or `level` is refused. Agent modes are provider-defined and have no order to compare.
- **Answer high-risk cards** covers cards with git hooks or git config, force push, agent instruction files or a secret file in their paths, and rail flags. A card that approves a saved sign-in needs the sign-ins switch.
- **Pair another device and manage devices** is stored but opens no route in this version: device, pairing-start, hostname and switch-write endpoints are never reachable from a phone.
- Never from a phone, by choice rather than by the plan's list: trusting a folder's hooks and MCP servers, `POST /api/tasks/:id/ship`, reading an instructions file by absolute path, the diagnostics export, the git installer, and opening a folder in Finder. Preview reads are refused along with preview control.
- Deleting a chat and unlinking a project sit behind **Reset or delete data**. Listing folders on the Mac sits behind **Link a new folder or clone a repo**.

Switches are `GET /api/remote/switches` (readable by a paired phone) and `PATCH /api/remote/switches` (local only), stored as columns of `remote_access_settings` with the proposed defaults.

### Audit

The run audit log is a per-run hash chain of agent traffic, so phone activity has its own table, `remote_audit`, pruned on the same retention setting and listed by `GET /api/remote/audit` (local only). A row is written before a remote write runs and gets the response status when it ends. Pairing start, submit, failure, confirm and deny, device paired, renamed and revoked, disconnect all, hostname and switch changes, and every refusal of a known device are rows too. Rows hold the device id and name, method and path; never a body, query string, code, claim or token.

### Focus

`POST /api/slack/presence` takes an optional `clientId`. Local windows are `local:<id>` and a phone is always `device:<device id>`, whatever it sends. Slack stays quiet while any client is focused, and one client's blur no longer clears another's focus. T4 can read the focused clients to quiet a phone's own notifications.

### What T2 needs

- Set the hostname with `PUT /api/remote/access` when Serve is on and `null` when it is off.
- Settings → Phone access reads `GET /api/remote/access`, `/devices`, `/pairings` and `/audit`, and writes the endpoints above.
- The server must run with `WEB_ROOT` for a phone to get the app and the themed pairing page; under `pnpm dev` Vite serves the app and a phone would see an unstyled pairing page and no app.

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
- No web app manifest or service worker.

## Design

### Pairing

1. On the Mac: Settings → Phone access → Pair a phone. Spark shows a QR code for two minutes.
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

Always allowed: read chats, plans, diffs, Work panel, Links, tickets, Docs; answer ordinary cards; send, queue and stop; Continue from here; start a chat in a linked project.

Never from a phone: terminal, Browser pane, preview, updates, island settings, native dialogs, Finder actions, and changing the phone switches themselves.

Switches in Settings → Phone access, changeable only on the Mac:

| Phone can…                                                   | Proposed default |
| ------------------------------------------------------------ | ---------------- |
| Change settings                                              | On               |
| Add or change providers and connections                      | On               |
| Link a new folder or clone a repo                            | On               |
| Raise agent mode or autonomy                                 | On               |
| Answer high-risk cards (git hooks, git config, secret files) | On               |
| Add, change and approve saved sign-ins                       | Off              |
| Reset or delete data                                         | Off              |
| Pair another device and manage devices                       | Off              |

The defaults are proposed, not yet confirmed by the owner.

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

1. Are the proposed switch defaults right?
2. Which address hosts the phone page and relay?
3. Is there also a default relay on the owner's account, or does every user deploy their own? (Decided 2026-10-05: users can point Spark at their own relay.)
4. Lowest iOS version to support (16.4 is the floor for notifications).
5. Should a Slack notification link open the phone app once paired?
