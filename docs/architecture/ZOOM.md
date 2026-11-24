# Zoom

Zoom is a small connector with one job: when the user creates a Google event from **New event** and picks **Zoom** under **Video call**, Spark creates a Zoom meeting for it and puts the join link on the event. Google's API can only request a Meet link (`conferenceData.createRequest`); it cannot create a conference from an add-on such as Zoom, so Spark asks Zoom directly.

Mac only. Every route is `never` in `route-rules.ts`. Agents get no Zoom tool.

## The Zoom app (owner, not done yet)

A **General app**, user-managed, in the Zoom Marketplace, with:

- **Use Public Client OAuth** on (App Credentials). Zoom then issues a separate public client ID. Spark uses that one and never a client secret.
- Redirect URL `http://127.0.0.1` on the public client and the allow list. Zoom ignores only the port of a loopback redirect; scheme, host and path must match, and it must be `127.0.0.1`, not `localhost`.
- Scopes `meeting:write:meeting`, `meeting:delete:meeting` and `user:read:user`. Nothing for recordings, chat or contacts.

An unpublished app only signs in members of the developer's own Zoom account. Anyone else needs the app to pass Zoom's Marketplace review (listed or unlisted), or Zoom's approval for a time-limited beta. Zoom may question a loopback redirect and a public client during review.

- **Dev:** `.local/zoom-oauth-client.json` holding `{"client_id": "<public client id>"}`; the desktop main process hands it to the API as `SPARK_ZOOM_CLIENT_ID`, and `pnpm dev` takes that variable from its environment.
- **Packaged builds:** `SPARK_ZOOM_CLIENT_FILE=<that file> pnpm desktop:package` bakes it into the app's `package.json` as `zoomApp` (`pnpm desktop:package` also finds `.local/zoom-oauth-client.json` by itself). A release does not require it. Without a client ID the Zoom card and the **Zoom** choice are hidden.

## Sign-in, once

`apps/server/src/zoom/` (`oauth.ts`, `api.ts`, `service.ts`, `routes.ts`).

- The authorization code flow with PKCE (S256) and a 32-byte `state` through the same one-shot loopback on `127.0.0.1` at a random port as the calendar sign-ins (`calendar/cloud/loopback.ts`), opened in the default browser, never the Browser pane. It times out after 10 minutes.
- The token request sends `client_id` and `code_verifier` in the body, with no `Authorization` header.
- One account per workspace (`zoom_accounts`: Zoom user id, email, `needs_sign_in`). The refresh token is in the keychain only (`zoom:<user id>`); the access token is in memory only.
- **Staying signed in.** Access tokens last one hour. Zoom rotates the refresh token on every renewal, so each renewal writes the new refresh token to the keychain before the new access token is used. Renewals are single-flight inside the API process, the only process that uses Zoom. A restart renews from the keychain with no prompt. Refresh tokens last 90 days, restarted by each renewal.
- **Keep-alive.** At start and once a day the API renews the sign-in if the last renewal (`zoom_accounts.renewed_at`) is over 7 days old, whether or not Zoom was used. So the 90 days are only reached when Spark itself is not opened for 90 days. A keep-alive that cannot reach Zoom changes nothing and tries again the next day.
- The user is asked again only when Zoom refuses the refresh token (a `400` or `401` from the token endpoint; any other answer is an error for that request and marks nothing), the keychain entry is gone, or a renewed token still gets `401`: the account is marked `needs_sign_in` and the card shows **Sign in again**. A busy or unreachable Zoom is an error for that one request and marks nothing.
- **Disconnect** revokes the access token (`POST /oauth/revoke` with `token` and `client_id`), deletes the keychain entry and the row. If Zoom does not confirm, the card says where to remove the app by hand.

## Creating the event

`zoom/event-video.ts`, called from `POST /api/calendar/events` when `video` is `zoom`.

1. `POST /users/me/meetings` with the event's title, start (UTC) and length in minutes.
2. The Google event is created with the join link as its **Location** (or, when the user typed a location, kept as typed) and as a "Join Zoom meeting:" line at the end of the description. Spark's Join already finds Zoom links in both.
3. If Google does not take the event (an error, or a missing grant), Spark deletes the Zoom meeting it just made.

Zoom allows about 100 meeting creations a day per user; a `429` is shown as that limit.

The link is plain text on the event, not the conference chip Zoom's own Google add-on makes.

## Not built

- Agents choosing Zoom in `spark_calendar_edit`. The chat worker would then renew tokens too, and rotation needs one renewer at a time across processes.
- Changing or deleting the Zoom meeting when the event later moves or is deleted.
- Zoom for Microsoft or Mac Calendar events, which Spark does not create.
