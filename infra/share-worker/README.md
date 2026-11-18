# Shared artifacts worker

A Cloudflare Worker that hosts the pages people share from Spark Outpost. When someone clicks **Share** on an artifact, the Mac app uploads that one HTML page here. The page is served at a link nobody can guess, optionally behind a passcode, until it expires or is deleted.

## API

All JSON errors look like `{ "error": "<code>" }`.

| Request                                         | Answer                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/shares` (JSON)                        | `201 { id, url, expiresAt }`, or `400 invalid_request`, `409 conflict`, `413 too_large`, `429 rate_limited`         |
| `DELETE /v1/shares/:id`, `Bearer <deleteToken>` | `204`, or `404 not_found` for an unknown id, a wrong or missing token, or an expired share; `429 rate_limited`      |
| `GET /a/:id`                                    | The viewer shell, or the unlock page for a passcode share without a valid unlock cookie; a plain 404 page when gone |
| `POST /a/:id/unlock` (form field `code`)        | `200` Verified page that sets the unlock cookie and refreshes to `/a/:id` after 2 s; `401` wrong code; `429` locked |
| `GET /a/:id/content?t=<token>`                  | The stored HTML, only to a frame and with a frame token minted by the shell in the last 60 seconds                  |
| `POST /a/:id/report` (form field `reason`)      | A small Thanks page; the report is stored and nothing is deleted                                                    |

The create body is `{ "id": string, "deleteToken": string, "title": string (1 to 120 characters), "html": string (at most 2 MiB of UTF-8), "expiresInDays": 1 | 7, "passcode"?: string, "theme"?: object }`. A passcode is 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, made by the Mac app. A theme is `{ scheme: "light" | "dark" }` plus ten colours (`bg`, `card`, `text`, `muted`, `line`, `accent`, `accentInk`, `ok`, `bad`, `strip`), each exactly `#rrggbb` in lower case; the worker's own pages for that share (unlock, Verified, report, viewer strip) use them, and a share without one follows the viewer's light or dark setting with neutral colours. Anything else, including unknown fields, is `400`. The rate limit counts every create request from an address, valid or not.

The Mac app picks the share's `id` (16 random bytes, 22 base64url characters) and its `deleteToken` (32 random bytes, 43 base64url characters) before it sends the request, so a create whose answer is lost can be sent again and the page can always be deleted:

- Nothing ever stored at that id: the page is stored and the answer is `201`.
- A live share at that id with the same delete token: nothing is written and the answer is `201` with that share's `id`, `url` and `expiresAt`.
- A live share at that id with another delete token, or one whose stored details can't be read: `409 conflict`, nothing changed.
- An id that was deleted, expired or named in a `DELETE`: `409 conflict`, for good, with any token.

The page is written with an R2 conditional put (`onlyIf: { etagDoesNotMatch: '*' }`), so two creates at the same id can't both write it.

### An id is used once

A link that stopped working must never show someone else's page, so an id is never given out twice. Removing a share (a `DELETE`, expiry on read, the daily run) first writes an empty object at `gone/<id>` and then deletes `shares/<id>`. A create checks for `gone/<id>` after its own write and takes its page back with `409` when the marker is there, so a create and a removal that cross can't leave a page behind.

A `DELETE` with a well-formed token for an id with nothing stored also writes `gone/<id>`, then looks once more for a page that was stored meanwhile (and deletes it when the token is its own), and answers `404`. The Mac app relies on this: after a create whose answer was lost it sends a `DELETE`, and a `404` then means the page is not there and can never arrive later. These writes need no token, so they are limited to 60 per hour per client address (`429` after that); a marker for an id nobody holds does nothing, and guessing a real id ahead of its create means guessing 128 random bits.

Markers are never deleted. Each is a zero-byte object with no metadata: one R2 write (Class A) per removed share, no stored bytes to bill, and the daily run never lists them because it lists `shares/` only.

## How a page is shown

- `/a/:id` returns a page of the worker's own with no scripts: a strip saying the page was shared from Spark Outpost and made by a user, not checked, a **Report** form, and an `<iframe sandbox="allow-scripts">` with the content below it.
- The content is served from `/a/:id/content` under its own Content Security Policy: `sandbox allow-scripts`, no `connect-src`, no forms, no frames, no workers. The page runs with an opaque origin and can't read this worker's pages or the viewer's cookies.
- A script can still navigate its own frame. Inside the shell that is stopped by the shell's `frame-src 'self'`: the browser refuses any address outside this worker before sending a request (checked in Chromium; Firefox and Safari not run), and popups and navigating the tab are blocked by the sandbox. No CSP directive stops a document that is a tab of its own from navigating away, so `/content` answers the 404 page when the browser says the request is not for a frame (`Sec-Fetch-Dest` present and not `iframe`). Browsers that don't send that header (before Safari 16.4, Chrome 80, Firefox 90) still get the content when someone opens the frame's address directly within its 60 seconds, and there a script could navigate that tab to another site. WebRTC is not covered by CSP.
- The iframe's address carries a token signed with `SIGNING_KEY`, bound to the share id and valid for 60 seconds, so the content address can't be passed around on its own.
- Every response has `nosniff`, `no-referrer`, `noindex`, `no-store` and a Permissions Policy that turns off the camera, microphone, location, clipboard and other device features. The content response never sets a cookie.

### Passcodes

- The worker keeps a salted PBKDF2-SHA256 hash of the passcode (100,000 iterations, the most the Workers runtime allows), never the code.
- The unlock page has no title of the page and no content. The code is typed into one field drawn as 8 boxes; the caret hides once 8 characters are in, and the form won't submit fewer. Spaces, dashes and lower case are accepted. The field holds 12 characters, so a pasted `ABCD-2345` with a space on either side is not cut short.
- A correct code answers with a Verified page (CSS animation only, the final state at once with reduced motion) that sets the cookie `__Secure-spark-share-<id>` (`HttpOnly; Secure; SameSite=Lax; Path=/a/<id>`, 12 hours, signed with `SIGNING_KEY`) and moves on to the page with a meta refresh after 2 seconds, or 1 second when a Chromium browser sends `Sec-CH-Prefers-Reduced-Motion: reduce`. An **Open the page** link appears after 4 seconds, for browsers that block the refresh.
- Each unlock attempt is counted before its code is checked. The 5th attempt locks the share for 15 minutes; it is still checked, and later attempts answer `429` until the lock ends, so at most 5 codes are checked per 15 minutes however many arrive at once. A correct code clears the count and the lock. Wrong codes never delete a share.
- The attempt counts live in a Durable Object (`ShareCounters`), one per share, which counts each attempt in one step.

## What gets stored

In the R2 bucket `spark-outpost-shares`:

| Key                          | Content                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shares/<id>`                | The HTML. Metadata: title, created and expiry times, SHA-256 of the delete token, the passcode's salt, hash and iterations, the theme |
| `gone/<id>`                  | Empty. Marks an id that was removed or asked to be removed, so it is never used again                                                 |
| `reports/<id>/<ms>-<random>` | `{ id, reason, reportedAt }`                                                                                                          |

The `ShareCounters` Durable Object keeps wrong-code counts per share and create and report counts per client address for one hour. Its storage holds only counts and times; the address is used only as the object's name, which Cloudflare hashes. The worker never logs request bodies, passcodes, tokens or addresses, and Workers logs are off in `wrangler.toml`.

An expired share is deleted the next time someone opens it, and every day at 03:17 UTC by the cron trigger, which also clears its attempt counts; both leave its `gone/<id>` marker. The daily run works through expired shares 20 at a time (markers, then the pages, then the counts), so a run that hits a plan's subrequest limit keeps what it finished and the next run goes on; an expired page is never served in between. Reports and markers are kept until you delete them.

## Limits

- Pages up to 2 MiB of HTML, titles up to 120 characters, expiry 1 or 7 days.
- 20 creates, 10 reports and 60 deletes of ids with nothing stored per hour per client address.
- Free plan: the passcode hash runs once when a passcode share is created and once per unlock attempt. Whether 100,000 PBKDF2 iterations fit the free plan's CPU limit has not been measured. If those requests fail with a CPU limit error, move to Workers Paid or lower `PASSCODE_ITERATIONS` in `src/crypto.ts`. A lower value only applies to shares created after the deploy: each share stores the count it was hashed with, so an existing passcode share still costs the old count on every unlock and keeps failing until the worker has enough CPU (Workers Paid) or the share is made again.

## Set up and deploy

You need a Cloudflare account. R2 must be enabled on it (the free tier is enough).

```sh
cd infra/share-worker
npx wrangler@4 login
npx wrangler@4 r2 bucket create spark-outpost-shares
openssl rand -base64 48 | npx wrangler@4 secret put SIGNING_KEY
npx wrangler@4 deploy
```

`SIGNING_KEY` must be at least 32 characters. Without it the viewer routes answer `503` (shares can still be created, deleted and reported). Changing it signs everyone out of passcode shares and breaks open frames for a minute; nothing else.

`wrangler deploy` prints the worker's address, for example `https://spark-outpost-share.<your-subdomain>.workers.dev`. Check it:

```sh
ID=$(openssl rand -base64 16 | tr '+/' '-_' | tr -d '=')
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
curl -i -X POST https://spark-outpost-share.<your-subdomain>.workers.dev/v1/shares \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"deleteToken\":\"$TOKEN\",\"title\":\"Test\",\"html\":\"<h1>Hello</h1>\",\"expiresInDays\":1}"
```

Delete the test share with the same token:

```sh
curl -i -X DELETE https://spark-outpost-share.<your-subdomain>.workers.dev/v1/shares/$ID \
  -H "authorization: Bearer $TOKEN"
```

To try it locally, run `npx wrangler@4 dev --local --var SIGNING_KEY:$(openssl rand -hex 32)` and open `http://127.0.0.1:8787`. Chromium keeps the `__Secure-` unlock cookie on `127.0.0.1` and `localhost`; other browsers may not, so check unlocking on the deployed address too.

## Bake the address into the app

Set `SPARK_SHARE_URL` to the worker's origin (no path) when you package the desktop app:

```sh
SPARK_SHARE_URL=https://spark-outpost-share.<your-subdomain>.workers.dev pnpm desktop:package
```

## Reports and taking a page down

Reports are under `reports/` in the bucket. Wrangler has no command to list objects, so browse them in the dashboard (**R2 → spark-outpost-shares → Objects**, filter by `reports/`), or read one you know:

```sh
npx wrangler@4 r2 object get spark-outpost-shares/reports/<id>/<name> --remote --pipe
```

Look at the reported page without running it:

```sh
npx wrangler@4 r2 object get spark-outpost-shares/shares/<id> --remote --pipe > reported.html
```

Take it down (the link answers 404 from then on). Write the marker first, so the id can't be used again:

```sh
: > empty
npx wrangler@4 r2 object put spark-outpost-shares/gone/<id> --file empty --remote
npx wrangler@4 r2 object delete spark-outpost-shares/shares/<id> --remote
```

Wrangler v4 works on local storage unless you pass `--remote`.

## Test

`pnpm test` runs `src/*.test.ts` with the repo's other unit tests, using in-memory fakes for R2 and the Durable Object. Nothing in them talks to Cloudflare. `src/contract.test.ts` checks that the worker's own limits (passcode alphabet and length, expiry days, page size, title length) match `packages/contracts`; the worker itself imports nothing from the repo.
