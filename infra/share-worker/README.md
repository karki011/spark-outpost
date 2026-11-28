# Shared artifacts worker

A Cloudflare Worker that hosts the pages people share from Spark Outpost. When someone clicks **Share** on an artifact, the Mac app uploads that one HTML page here. The page is served at a link nobody can guess, optionally behind a passcode, until it expires or is deleted.

## API

All JSON errors look like `{ "error": "<code>" }`.

| Request                                         | Answer                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/service`                               | `200 { service: "spark-share", maxDays: 1 \| 7, uploadKey: "required" \| "none" }`, or `401 unauthorized`, `429 rate_limited`                     |
| `POST /v1/shares` (JSON)                        | `201 { id, url, expiresAt }`, or `400 invalid_request`, `401 unauthorized`, `409 conflict`, `413 too_large`, `429 rate_limited`                   |
| `DELETE /v1/shares/:id`, `Bearer <deleteToken>` | `204`, or `404 not_found` for an unknown id, a wrong or missing token, or an expired share                                                        |
| `GET /a/:id`                                    | The viewer shell, or the unlock page for a passcode share without a valid unlock cookie; a plain 404 page when gone                               |
| `POST /a/:id/unlock` (form field `code`)        | `200` Verified page that sets the unlock cookie and refreshes to `/a/:id` after 2 s; `401` wrong code; `429` locked                               |
| `GET /a/:id/content?t=<token>`                  | The stored HTML, only to a frame and with a frame token minted by the shell in the last 60 seconds; a passcode share also needs the unlock cookie |
| `POST /a/:id/report` (form field `reason`)      | A small Thanks page; the report is stored and nothing is deleted. `400` unless the form was posted from this worker's own page                    |

The create body is `{ "id": string, "deleteToken": string, "title": string (1 to 120 characters), "html": string (at most 2 MiB of UTF-8), "expiresInDays": 1 | 7, "passcode"?: string, "theme"?: object }`. A passcode is 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, made by the Mac app. A theme is `{ scheme: "light" | "dark" }` plus ten colours (`bg`, `card`, `text`, `muted`, `line`, `accent`, `accentInk`, `ok`, `bad`, `strip`), each exactly `#rrggbb` in lower case; the worker's own pages for that share (unlock, Verified, report, viewer strip) use them, and a share without one follows the viewer's light or dark setting with neutral colours. Anything else, including unknown fields, is `400`. The per-client rate limit counts every create request from a client, valid or not, until the client is over it.

### Upload key and longest share

Two optional settings decide who may upload and for how long:

- `UPLOAD_KEY` (a secret). When it is set, `POST /v1/shares` and `GET /v1/service` need `Authorization: Bearer <UPLOAD_KEY>`, compared in constant time. A missing or wrong key answers `401 { "error": "unauthorized" }` before the body is read, and nothing is stored or added to the counts for all clients. The request still counts against that client's own limit (20 creates, 60 service requests per hour), so someone guessing keys gets `429` after that. When it is not set, or empty, anyone may upload, as before. Spark Outpost only accepts a key of 32 to 128 letters, digits, `-` or `_`, so make one with `openssl rand -hex 32`.
- `MAX_EXPIRY_DAYS` (a plain variable, `"1"` or `"7"`). A create whose `expiresInDays` is above it is `400 invalid_request`. Unset, or any other value, means 7.

`DELETE /v1/shares/:id` never needs the upload key: the share's own delete token is its only check, so a page can still be removed after the key changes.

`GET /v1/service` says what this copy accepts, so the app can check an address and key before it saves them: `service` is always `spark-share`, `maxDays` comes from `MAX_EXPIRY_DAYS` and `uploadKey` is `required` when a key is set, `none` otherwise. It says nothing else. `src/service.test.ts` checks the answer against `shareServiceInfoSchema` in `packages/contracts`.

The Mac app makes the `deleteToken` (32 random bytes, 43 base64url characters) before it sends the request, and the share's `id` comes from it:

```
id = base64url( first 16 bytes of SHA-256( "spark-share-id:" + deleteToken ) )      22 characters
```

For example, the token `Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4` gives the id `D65s4UWzkH75nfvCxUTMnw`. A create whose `id` is not the one its `deleteToken` gives is `400 invalid_request` and writes nothing. So the upload needs no account, and still only the holder of a share's key can ever store a page at its address: knowing a link (the id) gives no token that leads to it, short of inverting SHA-256. The prefix keeps the id unrelated to the stored `deleteTokenHash`, which is SHA-256 of the bare token. `src/contract.test.ts` checks that the worker (`shareIdFor` in `src/crypto.ts`) and the app (`apps/server/src/artifacts/share-id.ts`) give the same id for the same token.

Because the app has the key before it uploads, a create whose answer is lost can be sent again and the page can always be deleted:

- Nothing stored at that id: the page is stored and the answer is `201`.
- A live share at that id (it has the same delete token): nothing is written and the answer is `201` with that share's `id`, `url` and `expiresAt`, unless the id was retired meanwhile: then the page is removed and the answer is `409 conflict`.
- A stored object at that id whose details can't be read, or an expired share not yet removed (the create removes it): `409 conflict`.
- An id its owner deleted or asked to delete: `409 conflict`, for good.

The page is written with an R2 conditional put (`onlyIf: { etagDoesNotMatch: '*' }`), so two creates at the same id can't both write it.

### Delete

A `DELETE` removes a stored share when the SHA-256 of its bearer token equals the stored `deleteTokenHash`. That is the only check for a stored share, so shares stored before ids came from tokens (their ids are random) are still deleted with their own token.

A `DELETE` for an id with nothing stored answers `404`. When its token gives that id, the caller is the owner, and the worker first writes an empty object at `gone/<id>`, then looks once more for a page stored meanwhile and deletes it. Any other `DELETE` for an unstored id (a wrong token, an old random id) writes nothing.

A `404` carries the header `x-share-final: 1` when no page is stored at the id and none can arrive from the key in the request: either the id is retired (its marker is written), or the key does not give the id, so a create with that pair is always `400`. A `404` for a missing or malformed `authorization` header, or for a stored share whose key is another one, has no such header. The Mac app relies on the header: after a create whose answer was lost it sends a `DELETE` and forgets the share only on a `204` or a `404` with `x-share-final: 1`; a bare `404` (from a worker older than the header, which may not retire ids) leaves its row and key in place until the share's own end date. `src/contract.test.ts` checks the header's name against the app's (`ARTIFACT_SHARE_FINAL_HEADER`).

Writing a marker for an id with nothing stored is limited to 60 per hour per client (see [Limits](#limits)), since anyone can make a key and ask to retire its id. Over the limit the answer is `429 rate_limited` and nothing is written, never a `404`; the app keeps the row and tries again on its next hourly sweep. A repeat for an id already retired is not counted and writes nothing, and deleting a stored share with its key is never limited.

### What `gone/<id>` markers are for

A marker guards an owner against their own late or repeated upload: a create and a delete of the same id that cross, or a create that is still on its way when the app gives up and deletes. A delete by the owner writes `gone/<id>` before it deletes `shares/<id>`; a create looks for the marker before its write and again after it, and takes its page back with `409` when the marker is there. Nobody else can upload to the id at all, so markers are not what stops a removed link from showing someone else's page; the id check on create is.

Page views do not read markers: `/a/:id` is one R2 `head` and `/a/:id/content` is one R2 `get`.

Expiry writes no marker. A share expires at least a day after its create, long after any retry of that create has ended, and the app deletes the key when its link expires and never uploads an old pair again. If the key holder did upload again to their own expired id, the page would be their own.

Markers are never deleted. Each is a zero-byte object with no metadata: one R2 write (Class A) per share its owner removed or asked to remove, no stored bytes to bill, and the daily run never lists them because it lists `shares/` only. Markers written by earlier versions of the worker (for expired shares, and for unstored ids named by anyone) do nothing now and can be left or deleted.

## How a page is shown

- `/a/:id` returns a page of the worker's own with no scripts: a strip saying the page was shared from Spark Outpost and made by a user, not checked, a **Report** form, and an `<iframe sandbox="allow-scripts">` with the content below it.
- The content is served from `/a/:id/content` under its own Content Security Policy: `sandbox allow-scripts`, no `connect-src`, no forms, no frames, no workers. The page runs with an opaque origin and can't read this worker's pages or the viewer's cookies.
- A script can still navigate its own frame. Inside the shell that is stopped by the shell's `frame-src 'self'`: the browser refuses any address outside this worker before sending a request (checked in Chromium; Firefox and Safari not run), and popups and navigating the tab are blocked by the sandbox. No CSP directive stops a document that is a tab of its own from navigating away, so `/content` answers the 404 page when the browser says the request is not for a frame (`Sec-Fetch-Dest` present and not `iframe`). Browsers that don't send that header (before Safari 16.4, Chrome 80, Firefox 90) still get the content when someone opens the frame's address directly within its 60 seconds, and there a script could navigate that tab to another site. WebRTC is not covered by CSP: the `webrtc` directive of CSP 3 was tried and Chromium 153 reports it as unrecognised and still gathers ICE candidates, so it is not sent.
- The iframe's address carries a token signed with `SIGNING_KEY`, bound to the share id and valid for 60 seconds, so the content address can't be passed around on its own. For a passcode share the content request must also carry the unlock cookie, so a copied content address shows nothing to anyone who has not typed the code. The shell's frame request is same-origin and carries the cookie (checked in Chromium 153; Firefox and Safari not run). A request a script inside the page starts, such as reloading its own frame, is cross-site and carries no cookie, so a passcode page that reloads itself gets the 404 page.
- Every response has `nosniff`, `no-referrer`, `noindex`, `no-store` and a Permissions Policy that turns off the camera, microphone, location, clipboard and other device features. The content response never sets a cookie.

### Passcodes

- The worker keeps a salted PBKDF2-SHA256 hash of the passcode (100,000 iterations, the most the Workers runtime allows), never the code.
- The unlock page has no title of the page and no content. The code is typed into one field drawn as 8 boxes; the caret hides once 8 characters are in, and the form won't submit fewer. Spaces, dashes and lower case are accepted. The field holds 12 characters, so a pasted `ABCD-2345` with a space on either side is not cut short.
- A correct code answers with a Verified page (CSS animation only, the final state at once with reduced motion) that sets the cookie `__Secure-spark-share-<id>` (`HttpOnly; Secure; SameSite=Lax; Path=/a/<id>`, 12 hours, signed with `SIGNING_KEY`) and moves on to the page with a meta refresh after 2 seconds, or 1 second when a Chromium browser sends `Sec-CH-Prefers-Reduced-Motion: reduce`. An **Open the page** link appears after 4 seconds, for browsers that block the refresh.
- Each unlock attempt is counted per client before its code is checked. A client's 5th attempt locks the share for that client for 15 minutes; it is still checked, and that client's later attempts answer `429` until the lock ends, so at most 5 codes per client are checked per 15 minutes however many arrive at once. Other visitors are not locked out. A correct code clears that client's count and lock. Wrong codes never delete a share.
- A share also checks at most 50 wrong codes an hour from all clients together; past that every attempt answers `429` until the hour ends. A correct code is not counted, so a share opened by many people does not use the budget up. That keeps guessing bounded when an attacker has many addresses, and it means such an attacker can still lock a share for everyone for the rest of that hour.
- A share's counts are cleared by an alarm 15 minutes after its hour ends, once no lock from that hour can still be running.
- The attempt counts live in a Durable Object (`ShareCounters`), one per share, which counts each attempt in one step.

## What gets stored

In the R2 bucket `spark-outpost-artifact-shares`:

| Key                          | Content                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shares/<id>`                | The HTML. Metadata: title, created and expiry times, SHA-256 of the delete token, the passcode's salt, hash and iterations, the theme |
| `gone/<id>`                  | Empty. Marks an id whose owner deleted it or asked to, so the owner's own late upload is refused                                      |
| `reports/<id>/<ms>-<random>` | `{ id, reason, reportedAt }`                                                                                                          |

The `ShareCounters` Durable Object keeps, per share, wrong-code counts per client and one count for the share, and create, report and unstored-id retirement counts per client for one hour, plus two counts for all creates together (how many this hour, how many bytes today). A client is an IPv4 address or the /64 network of an IPv6 address (`src/client.ts`). A rate count's storage holds only a count and a time, and the client is only the object's name, which Cloudflare hashes. A share's attempt object stores each client that guessed wrong as a key until a correct code from that client, or until the share is removed. The worker never logs request bodies, passcodes, tokens or addresses, and Workers logs are off in `wrangler.toml`.

An expired share is deleted the next time someone opens it, and every day at 03:17 UTC by the cron trigger, which also clears its attempt counts; neither writes a marker. The daily run works through expired shares 20 at a time (the pages, then the counts), so a run that hits a plan's subrequest limit keeps what it finished and the next run goes on; an expired page is never served in between. Reports and markers are kept until you delete them.

## Limits

- Pages up to 2 MiB of HTML, titles up to 120 characters, expiry 1 or 7 days.
- 20 creates, 10 reports, 60 service requests and 60 retirements of ids with nothing stored per hour per client. A client is an IPv4 address, or the /64 network of an IPv6 address, so rotating addresses inside one IPv6 network does not get past a limit.
- All clients together: 600 creates per hour and 1 GiB of HTML per day (`ALL_CREATES_PER_HOUR`, `ALL_CREATE_BYTES_PER_DAY` in `src/api.ts`). Past either, creates answer `429 rate_limited` until the window ends. These are a brake on abuse and cost, not a quota for one user: someone with many networks can use them up and stop sharing for everyone for that window, so also set the Cloudflare rule below.
- 5 passcode attempts per client per 15 minutes and 50 wrong codes per share per hour.
- Free plan: the passcode hash runs once when a passcode share is created and once per unlock attempt. Whether 100,000 PBKDF2 iterations fit the free plan's CPU limit has not been measured. If those requests fail with a CPU limit error, move to Workers Paid or lower `PASSCODE_ITERATIONS` in `src/crypto.ts`. A lower value only applies to shares created after the deploy: each share stores the count it was hashed with, so an existing passcode share still costs the old count on every unlock and keeps failing until the worker has enough CPU (Workers Paid) or the share is made again.

## Analytics

The worker writes one data point per event to the Workers Analytics Engine dataset `spark_outpost_share_events` (binding `EVENTS`, `src/events.ts`). A point holds the event's name, one word of detail for `share_created` (`open` or `passcode`) and one number (the HTML's size in bytes for `share_created`, how many shares the daily run removed for `share_expired`, otherwise 1). Every point uses the same index. Nothing in a point identifies a share or a visitor: no id, title, address, country, user agent, token, passcode, report text or URL is written, and Workers logs stay off.

The events are `share_created`, `share_viewed` (the content was served to a frame), `unlock_ok`, `unlock_wrong`, `unlock_locked`, `share_deleted`, `share_expired`, `report_filed`, `create_rate_limited` (a client over its own limit), `create_global_limited` (all clients over the shared cap), `create_rejected` (a create answered `400` or `413`) and `create_unauthorized` (a create without the right upload key).

The binding is optional: without it (tests, a deploy before the dataset exists) nothing is written, and a failed write never fails a request. Counts per event per day, through the [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/):

```sh
curl "https://api.cloudflare.com/client/v4/accounts/<account-id>/analytics_engine/sql" \
  -H "Authorization: Bearer <api-token>" \
  -d "SELECT toDate(timestamp) AS day, blob1 AS event, SUM(_sample_interval) AS events FROM spark_outpost_share_events GROUP BY day, event ORDER BY day, event"
```

## Cloudflare settings

The worker's own limits are the last line. Set these in the account too; none of them is in `wrangler.toml`:

- A rate limiting rule on `POST /v1/shares` (for example 30 requests per 10 minutes per address, block), so floods are stopped before the worker runs.
- R2 lifecycle rules on `spark-outpost-artifact-shares`: delete objects under `shares/` after 8 days (a backstop for the daily run; the longest share is 7 days) and under `reports/` after 90 days.
- Keep the bucket's public `r2.dev` access off: pages must only be reachable through the worker.
- Serve the worker from a domain used for nothing else, not `workers.dev`, so a flagged page can't take other services or every link down with it. Set `SPARK_SHARE_URL` to that origin; links made earlier keep working only while the old address still routes to the worker.
- A billing alert for Workers, Durable Objects and R2.

## Deploy your own

This folder is a complete Worker project (`package.json`, `wrangler.toml`, `src/`), so Cloudflare's Deploy button can copy it into your own account:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/karki011/spark-outpost/tree/main/infra/share-worker)

`https://deploy.workers.cloudflare.com/?url=https://github.com/karki011/spark-outpost/tree/main/infra/share-worker`

1. Open the link and sign in to Cloudflare. It copies this folder into a new repository of yours, creates the R2 bucket and the Durable Object, and asks for the two secrets listed in `.dev.vars.example`.
2. Set `UPLOAD_KEY` to the value Spark Outpost shows (Settings → Connectors → Cloudflare, **Copy**), or to the output of `openssl rand -hex 32`, and keep a copy. Without it anyone who finds the address can upload to your account.
3. Set `SIGNING_KEY` to the value Spark Outpost shows, or to the output of `openssl rand -base64 48`. You never need it again.
4. Deploy. Cloudflare shows the worker's address, for example `https://spark-outpost-artifact-share.<your-subdomain>.workers.dev`.
5. In Spark Outpost open Settings → Connectors → Cloudflare and paste the worker's address and the upload key. Spark asks `GET /v1/service` with the key to check both.

Shares from your own copy can last 1 or 7 days. To allow only 1, add `MAX_EXPIRY_DAYS = "1"` under `[vars]` in your copy's `wrangler.toml`, or as a variable in the worker's settings.

Cloudflare's documentation for the button does not list Workers Analytics Engine among the resources it sets up. If the deploy stops at the `EVENTS` binding, delete the `[[analytics_engine_datasets]]` block from `wrangler.toml` in your copy: the worker runs the same without it and writes no events.

The button has not been run against this folder yet. The steps under [Set up and deploy](#set-up-and-deploy) do the same by hand; for your own copy also run `openssl rand -hex 32`, keep the output to paste into Spark Outpost, then run `npx wrangler@4 secret put UPLOAD_KEY` and paste that same value when asked.

## The hosted copy

The copy the app falls back to when no own copy is connected takes uploads from every install, so it has no `UPLOAD_KEY` and is held back by the limits below and the Cloudflare rules instead. It keeps pages for a day at most: set `MAX_EXPIRY_DAYS = "1"` under `[vars]` in its `wrangler.toml` (or as a variable in the dashboard) before deploying it. `GET /v1/service` then answers `{ "service": "spark-share", "maxDays": 1, "uploadKey": "none" }`.

### Spark's own copy

Spark's shared service keeps its first name and bucket, `spark-outpost-share` and `spark-outpost-shares`, so its address and stored pages don't move. They are in `wrangler.hosted.toml`, which also sets `MAX_EXPIRY_DAYS = "1"`. Deploy it with `npx wrangler@4 deploy --config wrangler.hosted.toml`; a plain `wrangler deploy` makes a separate `spark-outpost-artifact-share`. In the commands below, use the hosted names when you work on Spark's own copy.

## Set up and deploy

You need a Cloudflare account. R2 must be enabled on it (the free tier is enough).

```sh
cd infra/share-worker
npx wrangler@4 login
npx wrangler@4 r2 bucket create spark-outpost-artifact-shares
openssl rand -base64 48 | npx wrangler@4 secret put SIGNING_KEY
npx wrangler@4 deploy
```

For Spark's own copy, the same three steps use the hosted names:

```sh
npx wrangler@4 r2 bucket create spark-outpost-shares
openssl rand -base64 48 | npx wrangler@4 secret put SIGNING_KEY --config wrangler.hosted.toml
npx wrangler@4 deploy --config wrangler.hosted.toml
```

`package.json` pins the same Wrangler major for the Deploy button and for `npm install && npm run deploy`; it is not part of the repo's pnpm workspace.

`SIGNING_KEY` must be at least 32 characters. Without it the viewer routes answer `503` (shares can still be created, deleted and reported). Changing it signs everyone out of passcode shares and breaks open frames for a minute; nothing else.

After a deploy that changes how pages are shown or unlocked, open a passcode share in Safari and Firefox as well as a Chromium browser: the content frame needs the unlock cookie, and only Chromium has been checked.

`wrangler deploy` prints the worker's address, for example `https://spark-outpost-artifact-share.<your-subdomain>.workers.dev`. Check it:

```sh
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
ID=$(printf 'spark-share-id:%s' "$TOKEN" | openssl dgst -sha256 -binary | head -c 16 | openssl base64 | tr '+/' '-_' | tr -d '=')
curl -i -X POST https://spark-outpost-artifact-share.<your-subdomain>.workers.dev/v1/shares \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"deleteToken\":\"$TOKEN\",\"title\":\"Test\",\"html\":\"<h1>Hello</h1>\",\"expiresInDays\":1}"
```

Delete the test share with the same token:

```sh
curl -i -X DELETE https://spark-outpost-artifact-share.<your-subdomain>.workers.dev/v1/shares/$ID \
  -H "authorization: Bearer $TOKEN"
```

To try it locally, run `npx wrangler@4 dev --local --var SIGNING_KEY:$(openssl rand -hex 32)` and open `http://127.0.0.1:8787`. Chromium keeps the `__Secure-` unlock cookie on `127.0.0.1` and `localhost`; other browsers may not, so check unlocking on the deployed address too.

## Bake the address into the app

Set `SPARK_SHARE_URL` to the worker's origin (no path) when you package the desktop app:

```sh
SPARK_SHARE_URL=https://spark-outpost-artifact-share.<your-subdomain>.workers.dev pnpm desktop:package
```

## Reports and taking a page down

Reports are under `reports/` in the bucket. Wrangler has no command to list objects, so browse them in the dashboard (**R2 → spark-outpost-artifact-shares → Objects**, filter by `reports/`), or read one you know:

```sh
npx wrangler@4 r2 object get spark-outpost-artifact-shares/reports/<id>/<name> --remote --pipe
```

Look at the reported page without running it:

```sh
npx wrangler@4 r2 object get spark-outpost-artifact-shares/shares/<id> --remote --pipe > reported.html
```

Take it down (the link answers 404 from then on):

```sh
npx wrangler@4 r2 object delete spark-outpost-artifact-shares/shares/<id> --remote
```

Only the holder of that share's delete key could store a page at the id again. To stop that too (the uploader's app still holds the key until the link's end date), write the marker first:

```sh
: > empty
npx wrangler@4 r2 object put spark-outpost-artifact-shares/gone/<id> --file empty --remote
npx wrangler@4 r2 object delete spark-outpost-artifact-shares/shares/<id> --remote
```

Wrangler v4 works on local storage unless you pass `--remote`.

## Test

`pnpm test` runs `src/*.test.ts` with the repo's other unit tests, using in-memory fakes for R2 and the Durable Object. Nothing in them talks to Cloudflare. `src/contract.test.ts` checks that the worker's own limits (passcode alphabet and length, expiry days, page size, title length, id and token shapes) match `packages/contracts` and that the worker and the app give the same id for a delete token, and `src/service.test.ts` does the same for the service path, name and answer; the worker itself imports nothing from outside this folder.
