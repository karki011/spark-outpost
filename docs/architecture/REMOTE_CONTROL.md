# Remote control: rename, and Spark to Spark

Status: design only. Nothing here is built. Written 2026-10-09 on `spark/remote-control`.

The owner asked for two things:

1. Say "Remote control" instead of "Phone". A phone is not the only device that connects.
2. Control one Spark Outpost from another Spark Outpost.

This document builds on [PHONE_REMOTE.md](PHONE_REMOTE.md) and [BROWSER.md](BROWSER.md). Read those first. Nothing here changes how the gateway decides.

Words used below:

- **Host Mac**: the Mac whose Spark is being controlled. It runs the agents.
- **Controlling Mac**: the Mac the user sits at.
- **Device**: anything paired with a host Mac. A phone browser, a laptop browser, or another Spark.

---

## Part 1. Rename "Phone" to "Remote control"

### What already fits

The code under the surface is already neutral. No change is needed there.

- Server folder `apps/server/src/remote/`. Contracts `packages/contracts/src/remote.ts`.
- Every route is `/api/remote/...`. No route has "phone" in its path.
- Tables `remote_devices`, `remote_device_sessions`, `remote_passkeys`, `remote_access_settings`, `remote_audit`.
- The pairing page already says "Pair this device" and "Device name".
- The Devices card heading is already "Devices".

So the rename is a copy change, plus one guide page and one icon.

### "Phone" has two meanings. Only one is renamed.

- **Phone as the paired device.** Renamed.
- **Phone as a small screen.** Kept. `PHONE_QUERY`, `usePhone`, "phone shell", "phone layout", `map-phone.css`, `docs/design/RESPONSIVE.md` and the `source-rules` phone-query check all describe screen size. A Spark on another Mac is a remote device with a desktop-sized screen, so the two meanings must stay apart.

### Label table

This table is the contract between lanes. A lane changes a string only to the value here.

| Place                                  | Now                                                                                         | New                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Left bar item, and the item under More | Phone                                                                                       | Remote control                                                                                    |
| Left bar icon                          | A phone outline                                                                             | A neutral outline icon from the shared set (two screens). No phone shape.                         |
| Page title                             | Phone                                                                                       | Remote control                                                                                    |
| Page intro                             | Use Spark Outpost from your phone while the work stays on this Mac.                         | Use Spark Outpost from another device while the work stays on this Mac.                           |
| Page loading labels                    | Loading phone settings / phone access / phone activity                                      | Loading remote control / remote control / remote activity                                         |
| Status heading                         | Phone access is off / is on / needs a look                                                  | Remote control is off / is on / needs a look                                                      |
| Main switch                            | Phone access                                                                                | Remote control                                                                                    |
| Not-installed step                     | Install Tailscale on this Mac and on your phone, and sign in to both with the same account. | Install Tailscale on this Mac and on the other device, and sign in to both with the same account. |
| Connected mark                         | Phone connected                                                                             | Device connected                                                                                  |
| Pair card heading and button           | Pair a phone                                                                                | Pair a device                                                                                     |
| Pair status lines                      | Turn phone access on to pair a phone.                                                       | Turn remote control on to pair a device.                                                          |
|                                        | Turning phone access on… / off…                                                             | Turning remote control on… / off…                                                                 |
|                                        | Scan this with your phone, or type the code.                                                | Scan this with a phone, or open the address on the other device and type the code.                |
|                                        | That code ran out before a phone used it.                                                   | That code ran out before a device used it.                                                        |
| QR label                               | QR code that opens the pairing page on your phone                                           | QR code that opens the pairing page on another device                                             |
| Devices, empty                         | No phone is paired yet.                                                                     | No device is paired yet.                                                                          |
| Passkey note on Devices                | A paired phone can save a passkey … never pairs a new phone … each phone pairs again.       | The same sentences with "device" for "phone".                                                     |
| Switches heading (Mac)                 | What the phone can do                                                                       | What paired devices can do                                                                        |
| Switches note (Mac)                    | A paired phone can read chats, send messages and answer cards. …                            | A paired device can read chats, send messages and answer cards. …                                 |
| Switches heading (on the device)       | What this phone can do                                                                      | What this device can do                                                                           |
| Activity heading                       | Recent phone activity                                                                       | Recent remote activity                                                                            |
| Activity lines                         | Phone access turned on / turned off                                                         | Remote control turned on / turned off                                                             |
|                                        | What the phone can do was changed                                                           | What paired devices can do was changed                                                            |
|                                        | A phone that was paired before asked to pair again …                                        | A device that was paired before asked to pair again …                                             |
|                                        | A phone with no sign-in opened the pairing page                                             | A device with no sign-in opened the pairing page                                                  |
| Activity fallback name                 | A phone                                                                                     | A device                                                                                          |
| On the device: This device card        | This phone is paired. To rename or remove it, open Phone on your Mac.                       | This device is paired. To rename or remove it, open Remote control on your Mac.                   |
| Passkey button and lines               | Save a passkey for this phone / Lets this phone sign in again … / This phone already has …  | The same with "this device".                                                                      |
| Locked note (Settings, PR follow-up)   | Turned off for phones on your Mac                                                           | Turned off for remote control on your Mac                                                         |
| Server refusal message                 | Turned off for phones on your Mac: _switch label_.                                          | Turned off for remote control on your Mac: _switch label_.                                        |
| Server Tailscale messages              | … Turn phone access off, then on again. / Phone access was turned off because …             | … Turn remote control off, then on again. / Remote control was turned off because …               |
| Pairing page                           | Paired this phone before?                                                                   | Paired this device before?                                                                        |
| Pairing page name placeholder          | My phone                                                                                    | My device                                                                                         |
| Web app manifest description           | Spark Outpost on your phone, with the work staying on your Mac.                             | Spark Outpost on another device, with the work staying on your Mac.                               |
| Startup prune label (log line)         | old phone access entries                                                                    | old remote control entries                                                                        |
| Gateway log line                       | Could not record a phone request status                                                     | Could not record a remote request status                                                          |
| Guide page title                       | Use Spark from your phone                                                                   | Control Spark from another device                                                                 |
| Guide link text elsewhere              | a paired phone / your phone                                                                 | a paired device / remote control                                                                  |

Words that stay as they are: Devices, Pair, Confirm, Deny, Revoke, Remove old entry, Disconnect all, Allow passkey sign-in, Remove passkeys, the seven switch labels, "Connected to your Mac", "Change these on your Mac", "Confirm on your Mac".

Island notices: none mention the phone today. Nothing to change in `apps/desktop`.

Screenshots: `docs/guide/images/` has no picture of the Phone page. Nothing to regenerate. Browser spec screenshot names (`phone-page`, `remote-phone-page`, `phone-watching`, `docs-phone`) are test artefacts, mostly about screen size, and stay.

### What must not change

Nothing a paired device or a passkey depends on moves.

- The Serve address. It is the cookie's host and the passkey RP ID. The rename does not touch Tailscale.
- Cookie names `__Host-spark_device` and `__Host-spark_passkey`.
- The passkey user handle (the device id) and every stored credential.
- Every `/api/remote/...` path, the pairing link `https://<hostname>/#code=…`, and `spark_entry`.
- Table and column names. Applied migration file names, including `0137_phone_defaults.sql`.
- Audit action names (`hostname_changed`, `device_paired`, …) and switch ids (`settings`, `connections`, …). Old audit rows keep reading correctly because only the sentence built from them changes.
- The view id `'phone'` saved in the browser by `apps/web/src/app/saved-view.ts`. A device that last had this page open must still open it.
- CSS class prefix `ph-`.

Internal names that could change but do not have to: the folder `apps/web/src/phone/`, `PhonePage`, `phoneApi`, `phoneKeys`, `PHONE_SWITCH_OFF`, the `phone` spec group. Fifteen files outside the folder import from it, so renaming it collides with every other lane. See lane R6.

### Guide

- Rename `docs/guide/use-your-phone.md` to `docs/guide/remote-control.md` with the new title. Rewrite its steps with the new labels. It is a how-to page with a word cap; keep it inside the cap.
- Update the links in `docs/guide/outposts.md` and the existing row in `docs/guide/whats-new.md`.
- Add one row to `whats-new.md`: "Phone is now Remote control. Paired devices stay paired."
- Redirect: `use-your-phone` to `remote-control`. `AGENTS.md` names `packages/contracts/src/guide-redirects.ts` for this. That file was not found on this branch or on `main` on 2026-10-09. If it exists where this lands, add the entry. If it does not, keep the file name `use-your-phone.md` and change only its title and text, so no link breaks.

### Lanes for the rename

Each lane owns its files. No two lanes touch the same file. All lanes take their strings from the table above.

| Lane | Files                                                                                                                                                                                                                      | Unit tests it owns                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| R1   | Server copy: `apps/server/src/remote/policy.ts`, `tailscale.ts`, `pairing-page.ts`, `gateway.ts` (one log line), `apps/server/src/api/startup-prune.ts`                                                                    | `remote/policy.test.ts`, `test/remote-policy.db.test.ts`, `test/remote-tailscale.db.test.ts` |
| R2   | Page copy: `apps/web/src/phone/phone-copy.ts`, `pair-flow.ts`, `use-remote-client.ts`, `PhonePage.tsx`, `PhoneStatus.tsx`, `PhoneSwitches.tsx`, `PhoneDevices.tsx`, `PhoneActivity.tsx`, `PairPhone.tsx`, `PairScene.tsx`  | `phone-copy.test.ts`, `pair-flow.test.ts`, `PasskeyOffer.test.tsx`                           |
| R3   | Shell: `apps/web/src/app/Rail.tsx` (label and icon), `apps/web/src/app/App.tsx` (one `aria-label`), `apps/web/public/manifest.webmanifest`                                                                                 | none                                                                                         |
| R4   | Browser specs: `tests/browser/phone.spec.ts`, `phone-motion.spec.ts`, `phone-pair-again.spec.ts`, `phone-passkey.spec.ts`, `phone-support.ts`, `responsive-shell.spec.ts`, `pr-watching.spec.ts`, `outposts.spec.ts`       | the specs themselves                                                                         |
| R5   | Docs: the guide page, `outposts.md`, `whats-new.md`, the redirect entry, one line in `BROWSER.md` (the links table lists "Phone"), a pointer at the top of `PHONE_REMOTE.md`, `docs/architecture/ELECTRON_PLAN.md` wording | `pnpm check:docs`                                                                            |
| R6   | Optional, alone, after R1 to R5 merge: `git mv apps/web/src/phone apps/web/src/remote-control`, fix imports, `tests/browser/spec-map.ts` prefix, `scripts/test-selection.test.ts` paths. No string changes.                | `scripts/test-selection.test.ts`                                                             |

`AGENTS.md` is changed by the owner; see the last section.

### Tests and specs that must change

- `apps/web/src/phone/phone-copy.test.ts`, `pair-flow.test.ts`, `PasskeyOffer.test.tsx`: expected sentences.
- `apps/server/test/remote-policy.db.test.ts`, `remote-tailscale.db.test.ts`, `apps/server/src/remote/policy.test.ts`: the refusal and Tailscale messages, where they assert the text.
- `tests/browser/phone.spec.ts`: headings "Phone access is off", the "Phone access" switch, "Pair a phone", "Scan this with your phone", "No phone is paired yet.", regions "What the phone can do" and "Recent phone activity".
- `tests/browser/responsive-shell.spec.ts`: `UNDER_MORE = ['Phone']`, `navButton(phone, 'Phone')`, "Pair a phone", the locked note.
- `tests/browser/pr-watching.spec.ts`: the locked note.
- `tests/browser/phone-motion.spec.ts`, `phone-pair-again.spec.ts`, `phone-passkey.spec.ts`: any label from the table.
- Device names typed in tests ("Kitchen phone", "Test phone") are data, not labels. They can stay.

Checks to run: `pnpm check`, `pnpm test:db:changed`, `pnpm test:browser:changed`. The rename adds no route, so the policy walk must pass unchanged. That is the proof that no device breaks.

---

## Part 2. Spark to Spark

### What exists today

Any browser on the tailnet can already pair with a Mac's Spark.

- The host Mac turns on Tailscale Serve. Its address is `https://<mac>.<tailnet>.ts.net`.
- A browser opens the address, types the code, and the host Mac confirms.
- The browser gets the host's own web build and a device cookie. Only routes in `route-rules.ts` answer. Terminal, Browser pane, preview and access management stay on the host Mac.

So a second Mac can control the first one today, from Safari. Spark to Spark is mostly about doing that inside the app, safely, with the credential in the keychain.

### Options

**(a) Add a remote Spark.** The user pastes the host's address. This Spark pairs as a device. It then shows the host's remote web UI in a labelled window.

- New server authority on the host: none. The same gateway, the same rules.
- The UI is the host's own build, so two Sparks on different versions still work.
- Small: a list of saved Sparks, a window, and keychain handling for one cookie.

**(b) A merged view.** This Spark's sidebar lists the host's chats next to local ones.

- The controlling Mac's server would call the host's API with the device credential. A browser page on the controlling Mac cannot: the host refuses any Origin but its own.
- Every list, stream, card and cache key would need a "which Mac" field. Chat ids, project ids and run ids from two databases would mix in one TanStack Query cache.
- The two Sparks must agree on API shapes, so versions must match.
- The local server would hold remote content. Agents on the controlling Mac sit much closer to it.
- Large, and it touches most of the app. Not now. Revisit after (a) has real use.

**(c) Agents on one Mac talking to agents on the other.** A2A across Macs. This belongs with Outposts and is a later step. Today both A2A routes are `never` for a remote device, and that stays. Not designed here.

**Recommendation: (a).**

### User flow

On the host Mac (nothing new except one copy button):

1. Open **Remote control**. Turn **Remote control** on.
2. Select **Pair a device**. The page shows the QR, the code and the address.
3. New: **Copy pairing link** next to the code. The link is the one the QR already holds.

On the controlling Mac:

4. Open **Remote control**. A new card, **Other Sparks**, lists saved Sparks. Select **Add a Spark**.
5. Paste the host's address or the pairing link. Give it a name, for example "Studio Mac". Spark checks the address and saves the name and hostname.
6. A window opens, titled **Remote control · Studio Mac · studio.tail1234.ts.net**. It shows the host's pairing page. The code is filled in when a pairing link was pasted. The device name is filled in with this Mac's name.
7. The pairing page shows a six-digit matching code.

Back on the host Mac:

8. The pair scene shows the request: the name, **Spark Outpost**, and the matching code. The user selects **Confirm**.

On the controlling Mac:

9. The window loads the host's Spark. The user works there: reads chats, sends messages, answers cards.
10. Later, **Other Sparks → Studio Mac → Open** opens the window again, already signed in.

The pairing rules do not change. Pairing starts on the host Mac and is confirmed on the host Mac. A wrong, used or expired code gets the same refusal as today.

### Where the credential lives

The credential is the device cookie the host sets. It is as powerful as a paired phone.

| Place                                                 | Holds                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Keychain on the controlling Mac (`remote-spark:<id>`) | The cookie value. Through the same `SecretStore` as provider keys and saved sign-ins.         |
| Table `remote_sparks` on the controlling Mac          | id, name, hostname, a keychain reference, created, last opened. No cookie, no code.           |
| API on the controlling Mac                            | Name, hostname, and `paired: true` or `false`. Never the value.                               |
| Worker ⇄ main, over the worker's `parentPort`         | The value, once when a window opens and once when the host sets a new cookie. Never logged.   |
| The window's session, in memory                       | The cookie while the app runs. The partition is not persistent, so no cookie file is written. |
| Events, audit, logs, tool results, the web app        | Never the value.                                                                              |

How it moves:

- **Open.** The web app calls a local-only route. The worker reads the keychain and sends main the id, hostname, name and the cookie value (or none). Main puts the cookie in the window's session and loads `https://<hostname>/`.
- **Capture.** Main watches that one session for a change to `__Host-spark_device` on that one host. When the host sets it (first pairing, pairing again, a passkey sign-in), main sends the new value to the worker. The worker writes the keychain. The renderer never sees it.
- **Remove.** Deleting the saved Spark deletes the keychain entry and the row, closes the window and clears the session. A reset deletes every `remote-spark:*` entry, as it does for saved sign-ins.
- If the keychain cannot be read, the window opens unsigned and shows the host's pairing page. Nothing falls back to a file.

This follows the saved sign-in pattern in [BROWSER.md](BROWSER.md). One new thing: main sends a message to the worker that the worker did not ask for. That is a new, typed, validated message on the existing channel.

### What the remote window may and may not do

It is a paired device. Nothing more.

- It reaches only what `route-rules.ts` allows, behind the same switches, with the same redaction and the same audit rows on the host.
- No terminal, no Browser pane, no preview, no Finder actions, no diagnostics export, no updates on the host.
- It cannot change switches, pair or revoke devices, or touch Tailscale on the host.
- It cannot add a remote Spark of its own. The **Other Sparks** card is shown only in a local desktop window, and its routes are `never` for a remote device. So there is no chain from Mac to Mac to Mac.
- No new route on the host is needed for (a). Any route added later needs a rule or the policy test fails, as today.

Routes this design adds, all on the controlling Mac, all `never` in `route-rules.ts`:

- `GET /api/remote-sparks`, `POST /api/remote-sparks`, `PATCH /api/remote-sparks/:id`, `DELETE /api/remote-sparks/:id`, `POST /api/remote-sparks/:id/open`.

Limits the user will notice in the first version:

- Downloads are cancelled in this kind of window, so the audit CSV export and saving an attachment do nothing.
- Notifications are not available. Permission requests are denied.
- What the web app keeps in browser storage on the host's origin (for example the last open page) is lost when the controlling Spark quits.

### Electron

The window is built like a Browser pane tab, with its own name.

- **Never the app session.** Partition `spark-remote-<id>`, in memory. The launch token is attached only on the default session, so it can never reach the host. `browserSession` accepts only `spark-browser-` names today; the remote window needs the same guard under its own prefix.
- **Spark's own ports blocked.** The API port, the Postgres port and the Spark tool port, by port, whatever the host name. A page-set `X-Spark-Token` header is stripped. So the host's page cannot reach the controlling Mac's Spark.
- `sandbox` on, `contextIsolation` on, `nodeIntegration` off, no preload, no script injected. `window.sparkDesktop` does not exist in the page, and the web app already degrades without it.
- **One origin.** The window loads only `https://<saved hostname>`. A navigation or redirect to any other origin is cancelled; an `http` or `https` link opens in the default browser. Popups are denied. `file://` never loads.
- **A top-level view, not an iframe.** The pairing page and the entry bounce send `X-Frame-Options: DENY` and `frame-ancestors 'none'`. An iframe inside the app would show nothing. That header is right and stays.
- **The label is Spark's, not the page's.** The window title is built from the saved name and hostname. Page title changes are ignored. The title bar gets the accent tint so it does not look like the local window.
- No debugger is attached. Permission requests are denied. Downloads are cancelled.
- The address must be `https`, a `*.ts.net` name that passes `remoteHostnameSchema`, with no port, path, username or query. This Mac's own Serve hostname is refused.

Own window or a tab inside this Spark? Own window first. A native view inside the main window sits above the DOM, and the Browser pane needed snapshot handling for every dialog and menu that overlaps it. A separate window has none of that, and a title bar the page cannot draw over.

### Agents on the controlling Mac

Recommendation: agents cannot see or drive the remote Spark.

- The remote window is not a Browser pane tab. `spark_browser_tabs` does not list it. No `spark_browser_*` tool takes its id. No debugger is attached, so there is nothing to read with.
- No Spark tool is added for it. `spark_docs` may describe the feature; that is all.
- What the host shows is another machine's data: chats, diffs, tool output. It is untrusted data. If agents could read it, text in a remote chat could steer a local agent. If agents could type in it, a local agent could start runs on another Mac with that Mac's permissions.
- When the Browser pane later lets agents open external sites, saved remote Spark hostnames must be refused there by name.

A user can still type the host's address into a chat's Browser pane and pair that tab. That is possible today for any browser. It stays possible, pairs as a plain browser, and still needs a confirm on the host.

### The Devices card on the host

Today a row shows the name, added, last seen, connected and passkeys. A Spark and a phone look the same.

Add a kind to the device: `browser` (every device today) or `spark`.

| Row       | Shows                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| A browser | A browser icon. Name. Added, last seen, connected. Passkeys line when it has any. |
| A Spark   | The Spark mark. Name. The word **Spark Outpost**. Added, last seen, connected.    |

- The kind comes from the pairing request. The controlling Spark adds it to the pairing link, and the pairing page sends it with the code.
- It is a label, not a proof. Any browser could claim it. It grants nothing and no rule reads it. The confirm step shows it so the user knows what to expect, and the user still checks the matching code.
- The pairing page also reads a device name from the link, so the user does not type "My device" on a Mac.

### Revoke and the 30 days

All unchanged on the host.

- **Revoke** on the host ends the Spark's access at once and closes its streams. The remote window's next request is refused, and the next page load shows the pairing page.
- **30 days.** A Spark not opened for 30 days must pair again from the host. The controlling Mac shows **Last opened** on each saved Spark so this is not a surprise.
- **Remove** on the controlling Mac deletes its own copy of the credential. It cannot revoke on the host, because device management is Mac-only there. The card says: "Also revoke this Mac on Studio Mac."
- Optional, see decision 6: a route a device can call to end its own session. It only takes power away.
- **Disconnect all** on the host revokes Sparks too.
- If the host's tailnet name changes, the saved address is wrong. The user removes the saved Spark and adds it again.

### Same user's two Macs, and a teammate's Mac

**Your own two Macs, one tailnet.** Works. Both Macs are signed in to the same tailnet with HTTPS certificates on. This is the case the design is for.

**A teammate's Mac.** Not supported in this version. Stated plainly:

- A different tailnet cannot reach the address at all. Serve is not public, and Funnel is never used.
- Tailscale can share one machine into another tailnet. Then the address may answer. This was not tried, and Spark does not check who is on the other end: Tailscale identity headers are deliberately not read.
- Even when it connects, the access model is wrong for two people. A paired device can send messages that run agents in the owner's repositories, change settings and change connections. There is one set of switches for all devices and no per-person identity in the audit beyond the device name.
- PHONE_REMOTE.md says "One owner, their own devices". That stays true. Sharing with a teammate needs per-device permissions and a design of its own.

### Data model

Next free migration number is 0163. Do not create it from this document; the lane does. One file, two changes:

- New table `remote_sparks` (used on the controlling Mac): `id`, `workspace_id`, `name` (1 to 60), `hostname` (unique per workspace), `keychain_ref`, `created_at`, `last_opened_at`.
- New column `remote_devices.kind`: text, not null, default `'browser'`, checked to be `'browser'` or `'spark'`. Existing rows become `browser`. No token, session or passkey row changes, so no paired device is affected.

Contracts: `remoteDeviceSchema` and `pendingPairingSchema` gain `kind`; `pairingSubmitRequestSchema` gains an optional `kind`. A new small file holds the saved-Spark schemas and the address parser.

No audit table changes. The host already records every pairing step and every remote write with the device id.

### Lanes

Small files, one owner each. S1 goes first; the rest run in parallel.

| Lane | What                                                                                                                     | Files (new unless marked)                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| S1   | Contracts: saved-Spark schemas, `parseSparkAddress` (pure), the worker ⇄ main messages, `kind` on devices and pairings   | `packages/contracts/src/remote-sparks.ts`; edits `remote.ts`, `browser-bridge.ts`                                                |
| S2   | Storage: migration 0163, saved-Spark queries, `kind` read and written                                                    | `apps/server/migrations/0163_*.sql`, `apps/server/src/remote-sparks/store.ts`; edits `remote/store.ts`                           |
| S3   | Controlling-side API: the five routes, keychain read, write and delete, reset cleanup, five `never` rules                | `apps/server/src/remote-sparks/routes.ts`, `secrets.ts`; edits `remote/route-rules.ts`, `reset/reset.ts`                         |
| S4   | Host pairing: the page reads name and kind from the link; pairing carries `kind`                                         | edits `remote/pairing-page.ts`, `remote/pairing.ts`, `remote/routes.ts`                                                          |
| S5   | Desktop window: partition and guard, window and title, one-origin lock, cookie set and capture                           | `apps/desktop/src/remote-spark/partition.ts`, `window.ts`, `navigation.ts`, `cookie.ts`; edits `browser/bridge.ts`, `preload.ts` |
| S6   | Controlling-side UI: the Other Sparks card, the add dialog, the query hooks                                              | `apps/web/src/remote-sparks/OtherSparks.tsx`, `AddSparkDialog.tsx`, `remote-sparks-api.ts`; one line in the Remote control page  |
| S7   | Host UI: kind on a device row and in the confirm scene, **Copy pairing link**                                            | edits `PhoneDevices.tsx`, `PairScene.tsx`, `pair-flow.ts`                                                                        |
| S8   | Docs: guide page section, `whats-new.md` row, "what leaves the computer", pointers in `PHONE_REMOTE.md` and `BROWSER.md` | `docs/guide/remote-control.md` and friends                                                                                       |

Part 1 lands first. S6 and S7 edit files that R2 edits, and the remote window shows the host's copy to a Mac user, where "this phone" would be wrong.

### Test plan

Fakes only. No test runs the real `tailscale` CLI, a real keychain or a second Mac.

- **Address parser** (unit): accepts a Serve address and a pairing link; refuses `http`, a port, a path, a username, a non-`ts.net` name, an IP address, and this Mac's own hostname.
- **Saved Sparks API** (database tests): create, rename, delete; duplicate hostname refused; no response, row, event or log line holds a cookie value; delete removes the fake keychain entry; reset removes them all.
- **Policy walk**: the five new routes each have a rule and are refused for a paired device. A fake device that calls them gets `403` and an audit row.
- **Pairing kind** (database tests): a submit with `kind: spark` yields a pending request and a device row marked `spark`; no kind yields `browser`; an unknown kind is refused; pairing again keeps the row and updates the kind; the kind changes no decision in `remoteDecision`.
- **Pairing page** (unit): name and kind are read from the link, bounded and escaped; a bad value is ignored.
- **Partition and guard** (desktop unit tests): the remote partition name never resolves to the default session; Spark's ports are refused on it; the token header is stripped.
- **One-origin lock** (unit): same-origin allowed; another origin, another scheme, `file:` and `data:` refused.
- **Cookie handling** (unit, with a fake session and fake secret store): set on open; captured on change; a changed value replaces the stored one; nothing is written when the cookie belongs to another host or name.
- **Browser spec**: with the fake Tailscale in `tests/browser/bin/tailscale` and a fake desktop bridge, add a Spark, see it listed, remove it. The host flow with a `spark` device runs against the existing two-page pairing spec. New specs go in `tests/browser/spec-map.ts`.
- **Recovery**: host revokes while the window holds a stream; host restarts; controlling Spark restarts and opens signed in from the fake keychain; a keychain read that fails opens unsigned.

Left unverified until the owner tries it: two real Macs, a real tailnet, a real keychain on a signed build, and whether a passkey prompt works inside an Electron window.

### Risks

- **It is a powerful credential.** A paired Spark can do nearly everything a phone can, and every switch defaults on. Anyone who controls the controlling Mac's user account controls the host's Spark too.
- **The cookie passes through memory.** It is in the main process and the window's session while the app runs. It is not written to a file by Spark.
- **Wrong window, wrong Mac.** A user may send a message thinking it runs locally. The title and tint are the defence. The pages inside look the same on purpose.
- **"Your Mac" becomes unclear.** The host's copy says "on your Mac". Seen from another Mac, that reads as the wrong one. See decision 7.
- **The kind is self-declared.** A browser can call itself a Spark. Nothing trusts it.
- **A hostile host.** If the address belongs to someone else, their page runs in the window. It is sandboxed, has no launch token and cannot reach local ports. It can still show a convincing page. The user should never type a secret into a remote window.
- **Passkeys in Electron.** The pairing page may show "Sign in with a passkey" where the window cannot complete it. Pairing with a code still works.
- **Sleep.** A sleeping host does not answer. The window shows a plain "did not load" with Retry. The host-side "asleep or offline" states are not built yet either.
- **Development.** Under `pnpm dev` the API has no web build to serve, so there is no remote UI. Trying Spark to Spark needs two packaged or `desktop:dev` builds. A dev and a release Spark on one Mac cannot both hold the Serve address.
- **Real Tailscale is still unverified**, as PHONE_REMOTE.md already says.

### What in today's code stands in the way

Nothing blocks option (a). These gaps must be closed:

1. The pairing page reads only `#code=`. It has no way to receive a name or a kind.
2. `remote_devices` and the contracts have no kind.
3. The desktop session guard accepts only `spark-browser-` partitions and is tied to chat panes.
4. Browser-style sessions cancel downloads and deny permissions, so exports and notifications do not work in the window.
5. A device cannot end its own session; only the host can revoke.
6. All remote copy says "phone" and "your Mac".
7. The pairing page forbids framing. This is correct and rules out an iframe tab.
8. For option (b) only: the host refuses any Origin but its own and has no token-style API sign-in, so a merged view needs a server-side client and a second kind of credential.

---

## Owner approval needed

### Proposed `AGENTS.md` changes

Not applied. The paired-phone paragraph would read:

> - A paired device (a phone or computer browser, or another Spark Outpost) reaches the Mac only through Tailscale Serve (never Funnel) and the remote gateway in `apps/server/src/remote/`: the server still listens on `127.0.0.1` alone, a device signs in with a pairing confirmed on the Mac, and every route is refused unless `route-rules.ts` allows it, some behind the switches on the Remote control page (left bar, above Settings). A paired device may save a passkey and use it to sign in again in another browser at the exact Serve hostname, as the same device; a passkey never pairs a new device, stops working when the device is revoked or unused for 30 days, and its switch and removal stay on the Mac. Terminal, Browser pane, preview, and everything that manages remote control (Tailscale, pairing, devices, switches, audit) stay on the Mac; a new route needs a rule or the policy test fails. Read `docs/architecture/PHONE_REMOTE.md` and `docs/architecture/REMOTE_CONTROL.md` before changing it.

A new sentence after it, when Spark to Spark is built:

> - A Spark Outpost can control another one only as a paired device of that Mac: it shows the other Mac's remote web UI in its own window, in its own in-memory session partition, never the app session, with Spark's ports blocked, no node integration and no preload, locked to the saved Serve address. The device cookie is kept only in the keychain; no table, event, log or tool result holds it. Agents cannot see or drive that window, and what it shows is untrusted data. Saved Sparks are managed on the Mac only.

In the outpost paragraph, two words change:

> … never to a paired device or through Tailscale. A paired device may read an outpost, post, cancel, pause and rename; …

### Decisions

1. **The name.** "Remote control" for the page, the left bar item and the main switch; "paired device" for what connects. Recommend: yes, with the label table above.
2. **Rename the internal folder and identifiers too** (`apps/web/src/phone/` and friends)? Recommend: yes, but as lane R6, alone, after the copy lanes merge. Keep the saved view id `'phone'`.
3. **Guide page file name.** Rename to `remote-control.md` with a redirect, or keep `use-your-phone.md` and change only the title. Recommend: rename if the redirects file exists where this lands; otherwise keep the file name.
4. **Spark to Spark option.** Recommend (a), a labelled window showing the host's remote UI. Not (b) now. (c) later with Outposts.
5. **Where the credential lives.** Keychain only, with an in-memory window session. The cost is that the host page's own browser storage is lost when the app quits. The simpler choice is a persistent partition, which writes the cookie to Chromium's cookie file. Recommend: keychain only.
6. **A device may end its own session** (one new host route, allowed always, revokes only the caller). Recommend: yes, as a small follow-up. Until then the card tells the user to revoke on the host.
7. **"On your Mac" in the host's copy.** Keep it, or have the host send its name and say "on Studio Mac". Recommend: keep it for the rename; change it with Spark to Spark.
8. **Device kind.** Add `kind` (`browser` or `spark`) as a label that grants nothing. Recommend: yes.
9. **Own window or a tab inside this Spark.** Recommend: own window first.
10. **Agents and the remote window.** Recommend: no access, no tool, and saved Spark addresses refused when agents later get external sites.
11. **A teammate's Mac.** Recommend: not supported and not hidden. Say so in the guide. Per-device permissions are a separate design.
12. **Addresses accepted.** Only `https://*.ts.net`, no port or path. Recommend: yes, until the relay version exists.
