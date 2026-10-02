# Install heartbeat worker

A Cloudflare Worker that counts how many people run Spark Outpost and from which country. Nothing else.

The desktop app sends `POST /v1/heartbeat` about 30 seconds after launch and then every 24 hours while it runs, unless **Settings → Help → Send anonymous heartbeat** is off. The body is exactly:

```json
{
  "installId": "3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c",
  "version": "0.1.0-beta.1",
  "os": "darwin",
  "arch": "arm64",
  "channel": "beta"
}
```

`installId` is a random UUID v4 the app creates once and keeps in its data folder (`install-id`). The worker answers `204` on success, `400` for anything else on that path (unknown or missing fields, wrong types, bodies over 512 bytes, non-JSON), `405` for other methods and `404` for other paths.

## What gets stored

One data point per heartbeat in the Workers Analytics Engine dataset `spark_outpost_heartbeats`:

| Column    | Value                                               |
| --------- | --------------------------------------------------- |
| `index1`  | SHA-256 of `installId` (the raw ID is never stored) |
| `blob1`   | Country from `request.cf.country` (`XX` if unknown) |
| `blob2`   | App version                                         |
| `blob3`   | OS (`darwin`, `win32`, `linux`)                     |
| `blob4`   | Arch (`x64`, `arm64`)                               |
| `blob5`   | Channel (`stable`, `beta`, `dev`)                   |
| `double1` | Always `1`                                          |

The worker never reads, stores or logs the IP address, and Workers logs are off in `wrangler.toml`. Analytics Engine keeps data for three months.

## Deploy

You need a Cloudflare account (the free plan is enough) with Workers Analytics Engine enabled under **Workers & Pages → Analytics Engine**.

```sh
cd infra/heartbeat-worker
npx wrangler@4 login
npx wrangler@4 deploy
```

`wrangler deploy` prints the worker's address, for example `https://spark-outpost-heartbeat.<your-subdomain>.workers.dev`. The dataset is created on the first write.

Check it with a test heartbeat (it counts as one install from your country):

```sh
curl -i -X POST https://spark-outpost-heartbeat.<your-subdomain>.workers.dev/v1/heartbeat \
  -H 'content-type: application/json' \
  -d '{"installId":"00000000-0000-4000-8000-000000000000","version":"0.0.0","os":"darwin","arch":"arm64","channel":"dev"}'
```

## Bake the address into the app

Set `SPARK_HEARTBEAT_URL` to the full endpoint when you package the desktop app:

```sh
SPARK_HEARTBEAT_URL=https://spark-outpost-heartbeat.<your-subdomain>.workers.dev/v1/heartbeat pnpm desktop:package
```

The packaging script writes it into the app's `package.json` as `heartbeatUrl`. Builds without it never send a heartbeat. The address must use `https` (plain `http` works only for `localhost` or `127.0.0.1`, for trying the worker with `npx wrangler@4 dev`).

## Read the numbers

Create an API token with **Account → Account Analytics → Read**, then query the [Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/). Your account ID is on the Workers & Pages overview page.

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data-binary @query.sql
```

Daily active installs by country, last 30 days:

```sql
SELECT
  toStartOfDay(timestamp) AS day,
  blob1 AS country,
  count(DISTINCT index1) AS installs
FROM spark_outpost_heartbeats
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, country
ORDER BY day DESC, installs DESC
```

Installs by version, last 7 days:

```sql
SELECT
  blob2 AS version,
  count(DISTINCT index1) AS installs
FROM spark_outpost_heartbeats
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY version
ORDER BY installs DESC
```

An install that updated during the week shows under each version it ran.

## Test

`pnpm test` runs `src/worker.test.ts` with the repo's other unit tests.
