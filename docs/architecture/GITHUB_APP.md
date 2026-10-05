# GitHub App sign-in

Spark can connect GitHub through a GitHub App using the device flow, so the user signs in on github.com, picks repositories, and never pastes a personal access token. Code: `apps/server/src/ship/github/app-*.ts`, routes in `api/github-app-routes.ts`, storage in `persistence/github-app.ts` (migration 0117), UI in `apps/web/src/ship/GitHubAppPanel.tsx`.

The app ships **no client secret and no private key**. It uses only the app's public client ID, and nothing in the code accepts either secret.

## Create the GitHub App (once, by the person who builds Spark)

Spark cannot create the app for you. On github.com:

1. Open **Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization: the organization's **Settings → Developer settings → GitHub Apps**).
2. **GitHub App name**: any name. The URL form of it is the **slug**, shown in the app's public page address `https://github.com/apps/<slug>`.
3. **Homepage URL**: any page you own.
4. **Callback URL**: any placeholder such as `http://127.0.0.1/callback`. The device flow never calls it.
5. **Expire user authorization tokens**: on. Spark relies on 8-hour access tokens and rotating refresh tokens.
6. **Request user authorization (OAuth) during installation**: off.
7. **Enable Device Flow**: on.
8. **Webhook → Active**: off. Spark polls; it receives no webhooks.
9. **Repository permissions** (everything else stays **No access**):

   | Permission    | Access         | Used for                                                                                                  |
   | ------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
   | Metadata      | Read-only      | Mandatory. Repository default branch, collaborator permission lookups for PR follow-up trust.             |
   | Contents      | Read and write | Pushing the chat's `spark/*` branch over HTTPS.                                                           |
   | Pull requests | Read and write | Opening, updating and reading pull requests, reviews, review comments, PR comments and follow-up replies. |
   | Checks        | Read-only      | Check runs and their annotations on a pull request's head commit.                                         |

   Not needed today: **Commit statuses** (Spark reads check runs, not the status API) and **Issues** (comments on a pull request are covered by Pull requests). Add **Workflows: Read and write** only if pushed branches change files under `.github/workflows/`; GitHub refuses those pushes without it.

10. **Account permissions** and **Organization permissions**: none. **Subscribe to events**: none.
11. **Where can this GitHub App be installed?** Choose **Any account** if other people will use your build; **Only on this account** otherwise.
12. Create the app. On its **General** page copy the **Client ID** (starts with `Iv23li…`). Do not generate a client secret or a private key; Spark has no place for them.

## Give Spark the client ID and slug

Both values are public. Set them in one of two places:

- For a packaged build: the constants `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_SLUG` in `apps/desktop/scripts/builder-config.ts`, or `SPARK_GITHUB_APP_CLIENT_ID` and `SPARK_GITHUB_APP_SLUG` in the environment of `pnpm desktop:package`, which override the constants for that build. Packaging writes them into the app's `package.json` as `githubApp`, and the desktop shell hands them to the API and worker.
- For `pnpm dev` and `pnpm desktop:dev`: the same two environment variables on the running processes (for example in `.local/credentials.env`). A variable set at run time wins over the baked value.

With an empty client ID the **GitHub sign-in** option is hidden and the token and gh CLI flows are unchanged. The slug only builds the **Give Spark access to this repo** link (`https://github.com/apps/<slug>/installations/new`); without it that link is hidden.

## Sign-in flow

1. `POST /api/github/app/sign-in` asks `https://github.com/login/device/code` for a device code with the client ID and returns the user code and verification address. The address is accepted only when it is `https://github.com/…`.
2. Settings shows the code with **Copy** and **Open GitHub** (a plain link the default browser opens). Spark never drives the browser or enters the code.
3. The API process polls `https://github.com/login/oauth/access_token` at the interval GitHub gave, slower after `slow_down`, and stops on `expired_token`, `access_denied`, any other error, or **Cancel** (`DELETE /api/github/app/sign-in`). The flow lives in the API process, so closing Settings does not end it; only one flow runs at a time. `GET /api/github/app/sign-in` reports it. The codes stay out of `GET /api/github/connection`, so agent tools never see them.
4. On success Spark reads `/user`, lists `/user/installations` and each installation's `/repositories` (100 per page, up to 1,000 repositories), stores the tokens and records the login, repository names and expiry times.

## Tokens

- The access token (`ghu_…`), refresh token (`ghr_…`) and both expiry times are one JSON entry in the OS keychain (`github:app`). The database row `github_app_connections` holds only the login, state, expiry times, repository names and a generation counter. Tokens are never logged; audit and diagnostics redaction already matches `gh[pousr]_…`.
- Refresh happens five minutes before expiry and after a 401, without a client secret (GitHub allows that for device-flow tokens). One refresh runs at a time: a per-process promise plus a Postgres advisory lock across the API and worker processes. The generation counter tells the other process to re-read the keychain instead of using its cached copy.
- GitHub rotates the refresh token on each refresh; the new pair replaces the keychain entry before the generation moves.
- When GitHub refuses the refresh token, or it has expired, the connection becomes `needs_sign_in`. Settings shows **Sign in again**, Home and the Island show one notice, and nothing blocks a run: the route chain falls through to the token, gh, or the Create PR link.
- **Disconnect** deletes the keychain entry and the row. Revoking the authorization itself is done on GitHub (**Settings → Applications → Authorized GitHub Apps**).

## Route chain

For a repository on github.com that the sign-in covers, `app` is the first choice:

| Step      | Order                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Push      | The user's git login, then the app token, then a saved token (HTTPS remotes only, one-shot `GIT_ASKPASS`, username `x-access-token`). |
| API calls | App sign-in, then saved token, then `gh`, then a compare link.                                                                        |
| Clone     | The user's git login, then the app token, then a saved token, the same one-shot `GIT_ASKPASS` as a push. Only from **Add project**.   |

Pull requests are opened as the user (user-to-server token). A repository the sign-in does not cover skips `app` entirely. `GET /api/github/connection`, the branch chip tooltip, the Settings **Test** button, `spark_connectors`, `spark_pull_requests` and `spark_pr` name the route. Credentials never enter an agent's environment: Spark itself pushes and calls the API.

## Limits

- github.com only. GitHub Enterprise Server is out of scope for the App sign-in; the personal-token option still takes an Enterprise host.
- Coverage comes from the stored repository list (first 1,000). It is refreshed at sign-in, by **Check again**, and when the Settings window regains focus while a project is uncovered.
- GitHub rate limits are honoured: after a rate-limited answer the app route pauses until the time GitHub gives (at most an hour) and reports when to try again.
- Outbound hosts are fixed to `github.com` and `api.github.com`. `GITHUB_LOGIN_URL` and `GITHUB_API_URL` exist for local test stubs and accept only HTTPS or `127.0.0.1`.
