# Phone remote: plan

Status: plan, not built. Direction chosen by the owner on 2026-10-05: a Cloudflare relay with end-to-end encryption, the same web UI on the phone.

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

## How it fits together

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

## Phases

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
