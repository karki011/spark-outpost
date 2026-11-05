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

| Step      | Order                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Push      | The user's git login, then the app token, then a saved token (HTTPS remotes only, `GIT_ASKPASS` that answers once, username `x-access-token`). |
| API calls | App sign-in, then saved token, then `gh`, then a compare link.                                                                                 |
| Clone     | The user's git login, then the app token, then a saved token, the same one-shot `GIT_ASKPASS` as a push. Only from **Add project**.            |

Pull requests are opened as the user (user-to-server token). A repository the sign-in does not cover skips `app` entirely. `GET /api/github/connection`, the branch chip tooltip, the Settings **Test** button, `spark_connectors`, `spark_pull_requests` and `spark_pr` name the route. Credentials never enter an agent's environment: an authorized agent asks Spark to push (`spark_push`) and, when `gh` is not signed in, to open the pull request (`spark_pull_request`); Spark runs both.

## Pushes, hooks and the environment

A `git push` runs the repository's `pre-push` hook, and that hook is repository code: on many projects it installs, builds or tests against a private registry. Three shells differ in what such a hook can see:

| Variable                                                      | Terminal tab (`terminal/pty.ts`)                   | Agent's own shell (`agents/acp/agent-env.ts`)                                                    | Push run by Spark (`ship/push.ts`, `ship/push-branch.ts`)                           |
| ------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Starting point                                                | Spark's environment without secret-named variables | Spark's environment without secret-named variables                                               | Spark's environment without secret-named variables                                  |
| Login shell (`$SHELL -l`, profile and rc files)               | Yes, interactive: every export of the user is back | No                                                                                               | Yes: read once with `$SHELL -ilc 'env -0'` and overlaid                             |
| `PATH`                                                        | The login shell's                                  | Spark's                                                                                          | The login shell's                                                                   |
| `NPM_TOKEN`, `NODE_AUTH_TOKEN`, other `*TOKEN*`/`*KEY*` names | Present when the user's shell exports them         | Absent (`setup/environment.ts` strips `SECRET\|TOKEN\|PASSWORD\|KEY`)                            | Present from the login shell; withheld for a folder marked **Not trusted**          |
| `GH_TOKEN`, `GITHUB_TOKEN`                                    | Present when exported                              | Absent; a Builder that may not publish also gets an empty `gh` config dir and a blocked push URL | Present from the login shell                                                        |
| `npm_config_userconfig`, `HOME`, proxy settings               | Present                                            | Present when Spark's own environment has them                                                    | Present                                                                             |
| Spark's own secrets (`DATABASE_URL`, launch token)            | Absent                                             | Absent                                                                                           | Absent                                                                              |
| Spark's GitHub token (token route)                            | Never                                              | Never                                                                                            | Not in the environment: `GIT_ASKPASS` reads it from a 0600 file once and deletes it |

So an agent's own `git push` can fail in a hook that the same push passes from the terminal tab. The design keeps secret-named variables out of the agent and moves the push instead:

- `spark_push` (a Spark tool, offered when the chat has a project) asks Spark to push. `ship/agent-push.ts` checks the turn's publish authorization (the user's message asks, the chat is at Full auto → PR, the mode is Auto or Bypass permissions/Full access, or the turn is a follow-up round on the chat's own open pull request), takes only the chat's own branch (its `spark/` branch or the pull request branch the user adopted for it) and its configured remote, refuses a protected branch and a branch carrying Spark's internal commits, and never passes `--no-verify` or `--force`. There are no arguments to widen it.
- The push runs with the login-shell environment in its own process group, with no time limit shorter than 30 minutes (`PUSH_TIMEOUT_MS`; a build in a hook takes minutes, and the old 120 s limit killed it), and stops with the turn: cancelling the tool call or the run sends `SIGTERM` to the group, then `SIGKILL` after 5 s.
- The agent gets back the outcome, the hook's name when a hook stopped the push, and the last 40 lines of output. Before anything leaves the push, the exact value of every secret-named variable that was passed (6 characters or longer) and the token are replaced with `[hidden]`, on top of the usual pattern redaction. The audit entry `ship/agent_push` holds the same redacted tail and the names, never the values, of the secret-named variables that were passed. The chat shows a row for the push; a stopped push names the hook and expands to the tail.
- The agent's own `git push origin <branch>` is still allowed by the gate under the same authorization and is the path when Spark tools are not in the session; its hooks get the agent's environment.

### Threat model

A hook is code from the repository, and the agent can edit the repository. Whatever a hook is given, a hostile or careless hook can send elsewhere or write to disk in a form the output redaction does not recognise (encoded, split, or written to a file the agent then reads). The limits that hold:

- The hook gets what the user's own terminal already gives it: nothing is added beyond the login shell, and Spark's own secrets are never in it.
- Only an authorized publish of the chat's own branch to the repository's configured remote runs this way; an agent cannot use `spark_push` to run a command of its choosing with the environment.
- A folder the user marked **Not trusted** in Settings → Projects (`project_trust.trusted = false`) gets the login-shell environment without secret-named variables, and a failed push says so. A folder with no decision gets them, like the terminal; trust is asked only for folders that carry hooks, allow rules or MCP servers for agents, so requiring it would break every other project.
- Edits to git hooks and git config ask with hold-to-confirm in every mode; edits to files a hook calls (a package script, `.husky/pre-push`) are ordinary edits and are the residual risk in modes that do not ask.
- Stripping secret-named variables from the agent's shell is a guard against casual disclosure (`env`, `printenv`, a logged command line), not a sandbox: a command that starts the user's login shell re-reads the same profile files the terminal does.

### Spark's token and hook code

On the token route the old `GIT_ASKPASS` script printed `$SPARK_GIT_TOKEN`, which every child of `git`, the hook included, inherited. A push now uses `withOneShotToken`: the token sits in a 0600 file next to the script in a private temp directory, the script prints it for the first password prompt and deletes the file, and the directory is removed when the push ends. `git` asks before it runs `pre-push` (it needs the remote's refs first), so the hook starts with nothing to read. What remains: a process of the same user can read the file in the moment before git asks; a host that lets `git` list refs without signing in would run the hook first; and a hook that itself needs GitHub credentials over HTTPS (Git LFS) gets none on this route, so such repositories need the user's own git login. Clone (`withTokenAccess`) keeps the environment variable: a fresh clone has no repository hooks, and a clone can ask more than once.

## Limits

- github.com only. GitHub Enterprise Server is out of scope for the App sign-in; the personal-token option still takes an Enterprise host.
- Coverage comes from the stored repository list (first 1,000). It is refreshed at sign-in, by **Check again**, and when the Settings window regains focus while a project is uncovered.
- GitHub rate limits are honoured: after a rate-limited answer the app route pauses until the time GitHub gives (at most an hour) and reports when to try again.
- Outbound hosts are fixed to `github.com` and `api.github.com`. `GITHUB_LOGIN_URL` and `GITHUB_API_URL` exist for local test stubs and accept only HTTPS or `127.0.0.1`.
