# ACP agents

How Spark Outpost runs Claude, Codex and Z.ai (GLM) through the Agent Client Protocol, what the September 25, 2026 spike found, and the limits that remain.

## What runs today

This is the harness's **simple path**: a chat without a linked project folder. One agent session answers from the saved conversation. Do sessions can run the orchestrator's Architect, Builder and Critic roles instead (see "Provider choice" below).

```
message → run (Postgres) → worker claims job → ACP provider
  spawn agent → initialize → session/new (empty private folder) → session/set_config_option
  → session/prompt (chat note + saved history + message) → session/update stream → steps and text
  → stop reason → run finished, failed, or cancelled
```

- **Processes and sessions.** The worker starts `claude-agent-acp` or `codex-acp` from the server's dependencies, over stdio. A chat without a project works in a folder under `$TMPDIR/spark-outpost-sessions` (`SESSION_WORKDIR_ROOT`), and a later turn resumes the chat's agent session when it can (M6, `workflow/session-decision.ts`).
- **Context.** A fresh session gets the conversation from Postgres, the source of truth; a resumed session gets only the new message. Up to 36 KB of the newest messages are included, and the prompt says how many older ones were left out. Messages are not summarized yet. A chat's conversation session that has to be replaced gets a handoff instead of the raw history ([HARNESS_SIMPLE.md](HARNESS_SIMPLE.md#sessions)).
- **Settings.** The run first forces the chat mode, then applies the connection's model and effort through config options. Model and effort are matched by value first, then by display name. If a value isn't offered, the run adds a visible step saying the agent's default is used. If the chat mode can't be applied, the run stops before the prompt is sent.
- **Permissions.** Every permission request is declined with the agent's reject-once option, and the work log records a "Declined: …" step. A request that arrives after Stop is answered with the `cancelled` outcome, as the spec requires.
- **Cancel.** Stop sends `session/cancel`. The process is killed if the agent hasn't stopped within 5 seconds.
- **Errors.** Errors are turned into readable messages:
  - not signed in (ACP `auth_required`)
  - process exit
  - refusal
  - turn limit
  - failed start
  - a model the sign-in can't use, usage limit, rate limit, expired sign-in, context too long and overload (see "Model availability per sign-in")

  A provider's JSON error body is never the message: its inner `error.message` is shown, and the redacted raw text is kept in `runs.error_details` (the "Details from the provider" disclosure) and in the audit log.

  Agent stderr is kept in the run's audit log (redacted, up to 1 MB), never shown in the chat.

- **Provider choice.** A chat uses the provider picked in its composer, or the profile's default provider. The API refuses to queue a run when no provider is connected. Browser tests set `AGENT_RUNTIME=fake`, which routes `claude` and `codex` to the fake provider. With `FAKE_ACP_AGENT` set to `apps/server/test/fake-acp-agent.ts`, turns whose prompt contains `#build` go to that fake ACP agent instead, so the real orchestrator runs its Architect, Builder and Critic roles through the ACP adapter and the approval gate.
- **New chats are drafts.** New chat only makes an id in the browser. The conversation is saved in the same transaction as its first message, and it takes its title from that message's first line. Chats without messages are left out of the list, and the API deletes those older than a day when it starts.

Code:

- `apps/server/src/agents/acp/`
- `apps/server/src/workflow/run-input.ts`
- `apps/server/src/workflow/providers.ts`

## Ask in project folders (M1)

A chat can be linked to one or more project folders (repos) with `PATCH /api/conversations/:id/settings {projectIds}`. The list is ordered and the first repo is the primary one. Links live in `conversation_projects (conversation_id, project_id, position)`. Its runs are in Ask mode: the agent may read inside the folders but not change anything. See [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md#adapter-capabilities) for what each adapter really does.

- **Session (Claude).** `cwd` is the primary repo's real root; the agent process also starts there. The other repos go in `session/new.additionalDirectories` (absolute paths) only when `initialize` advertises `agentCapabilities.sessionCapabilities.additionalDirectories`. claude-agent-acp 0.81.2 advertises it. When an agent doesn't, the run keeps only the primary repo and adds a step such as "Claude can only open one repo per chat; using spark-outpost". If a root is gone, the run fails with a readable error naming it.
- **Session (Codex).** codex-acp 1.13.1's `read-only` mode is really a workspace-write sandbox rooted at `cwd`. We patch it (`patches/@agentclientprotocol__codex-acp@1.13.1.patch`, the same change as upstream [codex-acp#480](https://github.com/agentclientprotocol/codex-acp/pull/480)) so `read-only` is a `readOnly` sandbox: no writes, no network, reads allowed. Codex project runs start in the primary repo with `shell_tool` on, and get the other repos as `additionalDirectories`, which stay read-only because the adapter only widens `workspaceWrite` policies. A unit test fails if the patch is missing. Known gap: Codex's sandbox can read the whole disk, including secret files, so our secret-file list doesn't bind Codex. Remove this part of the patch when a codex-acp release includes #480; every patch part, its guard tests and the upgrade checklist are in [PATCHES.md](PATCHES.md).
- **Prompt.** The chat-only note is replaced by a note listing every linked folder, marking the primary one, and saying the agent may read files in them but must not change files or read outside them. Codex runs keep the chat-only note.
- **Spark instructions.** Every session, with Spark on or off, also gets a short "Working with the user" block from `agents/acp/spark-instructions.ts`: the coordinator (team) line, the user's first name when one is saved, and a tone line. Claude and Z.ai get it in `_meta.systemPrompt.append` (and the Agent tool when the session has tools), Codex in `developer_instructions`. None of it is a user setting any more; see HARNESS_PLAN "Spark simplified".
- **Client file system.** Only runs that read folders advertise `fs.readTextFile: true`; `writeTextFile` stays false.
  - `fs/read_text_file` goes through `projects/path-policy.ts` across all linked roots: absolute paths only, lexically and after `realpath` inside one of the roots (the closest root wins for nested repos, and every containing root's rules apply), secret files served and noted as a `secret_file` observation since October 6, 2026 (the list in `projects/secret-files.ts`: `.env` and `.env.*` except `.env.example`, SSH keys `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` and their `.pub` files, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credential(s)` files), each root's `.sparkignore` entries refused, 1 MB cap. Relative paths resolve against the primary root. `line` (1-based) and `limit` are honoured. A read adds a "Read `relative/path`" step (prefixed with the repo name when several are linked); a refusal adds "Refused `path` (reason)" and answers `invalid_params`; a missing file answers `resource_not_found`.
  - `fs/write_text_file` isn't advertised, so a call is answered `method_not_found` (-32601) with a "Declined: Write `path` (…)" step.
- **Permissions.** In Ask, requests are still declined with reject-once; in a project the step says "Ask mode only reads files; switch to Do to allow changes". The safe-mode lock is unchanged. Do mode is described below.
- **How Claude reads.** claude-agent-acp 0.81.2 never calls `fs/read_text_file`; it reads the disk with its own tools. Project runs get `tools: ['Read', 'Glob', 'Grep']` in `default` mode, and every Claude session (chat or project) is hardened through `_meta.claudeCode.options`:
  - `settingSources: []`, so the repo's and user's hooks, `env` and `apiKeyHelper` aren't loaded
  - `allowDangerouslySkipPermissions: false` and `settings.permissions.disableBypassPermissionsMode: 'disable'` outside Do; Do sessions let the adapter offer Bypass permissions (see "Do in project folders" below)
  - `settings.permissions.blockReadsOutsideWorkingDirectories: true`
  - deny rules built from `projects/secret-files.ts`, in both `disallowedTools` and `settings.permissions.deny`, as `Edit(**/<pattern>)` plus `Edit(//<extra repo>/**/<pattern>)` for each extra repo (the matching `Read` rules were removed October 6, 2026: reading a secret file follows the mode). Claude's rules can't express exceptions, so editing `.env.example` stays denied for Claude even though our path policy allows it.
- **Known gaps:** Claude's tools bypass our path policy; its deny rules, Grep/Glob coverage and outside-folder behaviour are unverified until the live test runs. Per the September 25 decisions, M1 ships without `sandbox-exec`.
- **Default repos.** A new chat starts with the repos most recently chosen for any chat (`workspace_settings.default_project_ids`, updated whenever a chat's repos change to a non-empty list). `GET /api/default-projects` returns them for drafts, and the server copies them into `conversation_projects` when the chat row is first created. Choosing "No project" leaves the chat empty and keeps the default.
- **API.** `GET /api/folders?path=` (picker, default `$HOME`), `GET/POST /api/projects` (each with `displayPath`, the root with `~` for the home folder), `PATCH /api/projects/:id {name?, commandAllowlist?}` (rename or allowlist), `DELETE /api/projects/:id` (removes the project from Spark Outpost only, never the folder; returns `{project, links}` so `POST /api/projects/restore` can undo it with the same id and chat links), `GET /api/projects/:id/git` (`{branch}`, from `git symbolic-ref` with a short-SHA fallback and a 2 s timeout; `null` outside git), `GET /api/projects/:id/files?query=` (up to 50 matches from `git ls-files --cached --others --exclude-standard`, or a bounded walk outside git; secrets left out), `POST /api/projects/:id/attachments {path}` (text files up to 512 KB, stored with `source_path`). The web app searches every linked repo and merges the results.

Code: `apps/server/src/projects/`, `apps/server/src/persistence/conversation-projects.ts`, `apps/server/src/agents/acp/fs-handlers.ts`, `apps/server/src/agents/acp/session-request.ts`, `apps/server/src/api/project-routes.ts`.

## Do in project folders (M2)

A chat linked to a project runs in Do mode when its agent mode (`overrides[provider].agentMode`, default from `provider_connections.agent_mode`) is not read-only; the harness autonomy is `.level`, defaulting to `profiles.default_level`. The run records `runs.mode` (`chat`, `ask`, `do`), `runs.agent_mode` and `runs.level`. See [HARNESS_PLAN.md](HARNESS_PLAN.md#provider-permission-modes-september-28-2026) for the decision rules.

- **Claude.** Same hardening as Ask, with `tools: ['Read','Glob','Grep','Edit','Write','Bash']`. The chosen Claude mode is applied and decides what reaches `session/request_permission`; Do sessions let the adapter offer Bypass permissions. Spark adds ask rules only where its own rules need the gate: `['Bash(git push:*)','Bash(gh:*)']` for a solo Builder (the publish rules), and, for every session with the Edit tool, path rules for the safety floor's protected files (`floorAskRules` in `agents.ts`, from `EXACT_PROTECTED_GLOBS` in `projects/path-policy.ts`): `Edit(**/AGENTS.md)`, `Edit(**/CLAUDE.md)`, `Edit(.claude/**)`, `Edit(.cursor/rules/**)`, `Edit(.github/copilot-instructions.md)`, `Edit(.git/hooks/*)` and `Edit(.git/config)`, repeated under each extra linked repo. Claude Code sends a matching Edit, Write or NotebookEdit to `session/request_permission` in every mode, Auto and Bypass permissions included, and the gate's own rules answer it; no other edit, no read and no command is affected (checked October 10, 2026 against claude-agent-acp 0.81.2 with a scripted model on 127.0.0.1). The rules name paths, so they do not see a shell command that writes the same files (a redirect, `tee`, `git config`): in Auto and Bypass permissions that still runs without a request and is flagged afterwards. `.spark/` has no rule, because a glob there also matches the session's plan file in `.spark/plans/`. A piece gets no command ask rules, whether or not it shares its working tree with other pieces: it follows the agent's mode. The prompt note says the agent may change files and that a denied action must not be retried another way.
- **Codex** (since September 26, [CODEX_DO.md](CODEX_DO.md)). Our codex-acp patch adds the mode `ask-every-action`:
  - `approvalPolicy: "untrusted"` with approvals reviewed by the user
  - a `workspaceWrite` sandbox with no network and no `/tmp`; the run's private `TMPDIR` stays writable
  - a `decline` option on command and file-change requests, so a denied action lets Codex continue instead of ending its turn

  `ask-every-action` is Codex's asking mode (`AgentDefinition.doMode`): Ask every time uses it, and it is the fallback when a chosen mode is unavailable. A live switch to a mode the run may not use stops the run. Live, every command, including `ls`, `cat` and `git status`, and every `apply_patch` reached `session/request_permission`, so `decide()` sees each action. Codex Do opens only the primary repo (`doPrimaryRootOnly`, because extra folders would become writable roots) and adds a step saying so. Approve for me and Full access skip the gate (`modeSkipsGate`) and run wherever the chat works, watched by Spark; Ask every time runs where the autonomy puts it, and every Full auto → PR Builder uses a worktree.

  Known gaps:
  - Codex's sandbox reads the whole disk. We see and ask about commands that name a secret file, but not what a search or script reads.
  - If Codex asks to escalate, one approval runs the command outside the sandbox, with network, and the request doesn't show it.
  - The picker, Settings and the approval card say both.

- **Permission requests** (`permission-request.ts`, `do-handlers.ts`): the tool kind, title, `rawInput.command`/`cwd`/`file_path`, diff content and locations become an approval request for the gate in `workflow/approval-gate.ts`. The user's chosen option goes back as sent, including `*_always`, which is also stored as a run rule; when the gate decides by itself it answers `allow_once` or `reject_once`. It stores every answer as an approval receipt with the JSON-RPC id and tool-call id (the link into the audit log), and adds an "Allowed …", "Denied: …" or "Cancelled: …" step. A request after Stop answers `cancelled`.
- **`fs/write_text_file`** is advertised in Do only. The path policy runs first (secret files, `.git/`, outside the roots are refused), then the gate with the old and new text; an approved write creates missing folders. Neither real adapter calls it.
- **Snapshots.** Before the prompt, the worker records a git snapshot of the primary repo (a commit under `refs/spark-outpost/runs/<runId>`, made from a temporary index) or, outside git, copies each file before an approved edit. "Revert to before this run" restores only files changed since then.
- **Safe reads and installs** (`approvals/command-kinds.ts`, both providers). In every mode whose requests reach the gate, one simple read-only command runs without asking when every path is inside the project. Package installs always ask, in every mode, unless they only restore the lockfile (a frozen or offline install that adds no packages).
- **Known gaps:** Claude's Bash runs unsandboxed after approval (the card says so). Git snapshots skip ignored files. Outside git, files changed by commands are not backed up.

## Chat settings, capabilities, and usage

- **Per-chat settings.** Each conversation stores its current provider and, per provider, the model, effort, agent mode, autonomy and other config options picked in that chat (`conversations.overrides`). Switching provider and back keeps those picks. A new chat starts on the connection defaults. Every run records the model and effort it was sent with.
- **Capability snapshots.** `provider_capabilities` caches each agent's model and effort lists, read from the config options in `session/new`.
  - The API fills the cache with a probe that runs `initialize` and `session/new` without prompting, so it costs no usage and takes about 5–10 s.
  - The worker refreshes the cache on every run.
  - `GET /api/providers/:provider/capabilities?refresh=1` forces a new probe.
- **Usage.** Each run saves what the agent reports, and there is no default cost cap. When the agent reports no cost (Codex), the cost is estimated from the tokens and `apps/server/src/usage/prices.ts`, and `costSource` says `estimated`.
  - `usage_update` gives context used, window size, and cost in USD, cumulative for the session. Since session resume (M6), a run may continue an earlier session, so this value is the session's running cost, not only the run's own.
  - The `session/prompt` response's `usage` gives input, output, total, cached read and write, and thinking tokens.
  - Each finished reply shows its tokens and cost, with a breakdown on hover or focus. The run's `usage.costSource` says whether the cost is `reported` or `estimated`; the web app does not label estimates yet.
  - The conversation detail includes `usageTotals`: the chat's cost and tokens, and per provider its runs, cost, tokens, and last context reading.
  - The composer's context ring shows the current provider's last context reading, plus the chat totals and per-provider lines when more than one provider was used.
  - `GET /api/usage/summary` totals runs, cost, and tokens per provider for the last 30 days and all time. Settings shows them under Usage.
- **Tests without real agents.** With `AGENT_RUNTIME=fake`, the API returns a fixed fake capability snapshot and the fake provider reports usage, so browser tests never start real agents.

## Model availability per sign-in (October 5, 2026)

A released build showed `Codex stopped with an error: {"type":"error","status":400,…"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}`. Spark has no card for that model; it reached the run through the agent's own list. This section is what Spark now knows per connection and how it reacts. Nothing here was run against a real ChatGPT-account session.

**What the pinned adapters report**

|                       | claude-agent-acp 0.81.2                                                                                                          | codex-acp 1.13.1                                                                                                                                                    | Z.ai (claude-agent-acp)                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Model list            | `model` config option, built from the SDK's model list for the signed-in account                                                 | `model` config option, built from the app-server's `model/list`. When the configured model is not in that list the adapter adds it first, with a `null` description | The slots Spark configures through `ANTHROPIC_DEFAULT_*`, not a list |
| Account kind          | `_auth/status_update` push: `kind` (`account`, `api_key`, `gateway`, `external`, `none`), `label` ("Claude Max"), `account.plan` | The same push: `label` "ChatGPT Plus" or "OpenAI API key", `account.plan` from the app-server's `planType`                                                          | Not used: the key decides                                            |
| Availability recorded | Listed models are `usable`                                                                                                       | Listed models are `usable`; the added, undescribed current model is `unknown`                                                                                       | Always `unknown` (`reportsModelAccess` is off)                       |
| Model rejection       | JSON-RPC error on `session/prompt` with `data.errorKind: "model_not_found"`                                                      | `sessionFailure` with category `request` whose title is the raw HTTP body                                                                                           | As Claude, or Z.ai code `1211`                                       |

Whether either list matches what an account can really use is unverified, and the report above shows it can be wrong. That is why a rejection is also learned.

**What is stored.** `provider_model_access` (migration 0129) holds one row per provider connection: `method`, `account_kind`, `account_label`, `account_plan`, `listed`, `unlisted`, `rejected` (`[{id, label, at}]`) and `reported_at`. The probe (connect, verify and `?refresh=1`) and every run's `capabilities` output refresh the list; an `account` output records the sign-in. A different method, account kind or plan clears `rejected`, and so does verifying the provider again. `model-access/access.ts` rates a model `unusable` (rejected), `usable` (listed in a report) or `unknown` (everything else, including every model of a provider that reports no list).

**Where it is applied**

- `getCapabilities` adds `availability` and, for an unusable model, `switchTo` (the nearest usable one) to each model, an `access` summary (account, counts, `defaultIssue`), and never returns an unusable or unlisted model as the default while a usable one exists.
- `loadIntakeContext` gives routing only the selectable models (confirmed ones first, unknown ones only when none is confirmed), so rules, Jev tiers, the Critic, pieces, the Integrator and "one tier up" all pick from them. A route whose pick stands in for a rejected model records it in the route note and the decision summary ("GPT-6.1 Sol not usable with this sign-in → 6 Sol").
- `loadRunInput` is the last gate for every run, child runs included: a model known to be unusable is replaced by the nearest usable one (`model-access/nearest.ts`: same tier, then the nearer tier, lower before higher, never the frontier tier unless that was asked for) and the turn says so.
- `workflow/model-guard.ts` wraps the provider call. On a `ModelRejectedError` it marks the model, and retries the turn once on the nearest usable model only if no tool call, edit, plan or reply text has been produced; otherwise the run fails with a plain message. Both cases store `runs.model_switch` and emit a `model_switch` activity, which the chat shows with a link to Settings > Models.

**Error shapes matched** (`agents/acp/provider-failures.ts`, tests in `provider-failures.test.ts`)

- Model not usable: Codex "The '…' model is not supported when using Codex with a ChatGPT account."; OpenAI `code: "model_not_found"` or "The model … does not exist or you do not have access to it"; Anthropic `not_found_error` with `model: …`; Claude Code "There's an issue with the selected model (…)"; the Claude adapter's `errorKind: "model_not_found"`; Z.ai code `1211` with "Unknown Model".
- Usage limit: `insufficient_quota`, `billing_error`, "usage limit", "credit balance is too low", Z.ai `1113` and `1308`–`1321`.
- Rate limit: status or code 429, `rate_limit_error`, Z.ai `1302` and `1305`.
- Sign-in expired: status 401, `authentication_error`, `invalid_api_key`, "token expired".
- Context too long: `context_length_exceeded`, "prompt is too long", "maximum context length", "context window".
- Overloaded: status 529, `overloaded_error`.
- Any other JSON body: its inner message after "… stopped with an error:".

A pin the agent no longer lists at all still falls back to the default when the message is sent (`api/run-target.ts`), and the run now carries the same chat note.

**Known gaps:** API-key connections for Claude and Codex still don't run; a model that works for one effort or mode only is not modelled.

## Z.ai (GLM) (September 26, 2026)

Z.ai is a third provider, `zai`, named "Z.ai (GLM)". It runs the same `claude-agent-acp` against Z.ai's Anthropic-compatible endpoint, so Claude Code is the agent and GLM is the model. The Z.ai docs we rely on are summarised in [GLM_NOTES.md](../reference/zai/GLM_NOTES.md).

- **Connection.** API key only (`methods: ['api_key']`). The key is verified with one `POST {ZAI_BASE_URL}/v1/messages` to `glm-5.3-flash` with `max_tokens: 16` (Bearer auth), stored in the OS keychain as `zai:api_key` like the other keys, and shown masked (`…abcd`). The terminal and CLI verification refuse `zai`. Z.ai error codes are explained (1113 no balance or plan, 1302/1305 rate limit, 1308–1321 plan quota).
- **Clean launch** (`agents/acp/zai.ts`, `agent-env.ts`). The worker reads the key from the secret store at run time and builds the environment from an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TMPDIR`, `TERM`, `TZ`, CA and proxy variables), not from the server's environment. Nothing named `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*` or `OPENAI_*` is inherited. It then sets:
  - `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `ANTHROPIC_AUTH_TOKEN=<key>`
  - `ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL=glm-5.3[1m]` and `ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash[1m]`, each with `_NAME` and `_DESCRIPTION`, so the picker and Jev see "GLM-5.3" and "GLM-5.3-Flash" with strengths and prices
  - `API_TIMEOUT_MS=3000000`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, as the Z.ai docs recommend
  - `CLAUDE_CONFIG_DIR` set to an isolated, `0700` config home (`$TMPDIR/spark-outpost-zai-claude`). Claude Code then reads no `~/.claude` settings, plugins or `.credentials.json`, and its keychain item name gets a hash suffix of that directory, so the user's `Claude Code-credentials` login is never looked up. The directory is shared by Z.ai runs so session resume works.
- **No fallback to the Claude login.** Besides the clean environment, `claude-agent-acp` runs with `--hide-claude-auth`, which refuses any session whose account would bill a claude.ai subscription.
- **Same hardening as Claude.** The Z.ai definition reuses Claude's session options: `settingSources: []`, the secret-file deny rules, `blockReadsOutsideWorkingDirectories`, the `default` mode lock, and Do with `ask: ['Bash','Edit','Write']` through the approval gate. Bypass stays disabled outside Do, as for Claude.
- **Models and effort.** The adapter offers `default`, `opus`, `sonnet`, `haiku` and `claude-fable-5-1`. `offers` keeps only `opus` (GLM-5.3) and `haiku` (GLM-5.3-Flash), and the efforts Low, High and Max (GLM-5.3 has only these levels; High is the default). The probe and each run's capability report are filtered the same way, and the probe with the key spends nothing.
- **Cost and model records.** Claude Code's reported cost uses Anthropic prices, so a Z.ai run drops it (`estimatesCost`), and the run is priced from its tokens at the GLM rates with `cost_source: 'estimated'`. `used_model` records the GLM model (`glm-5.3`, `glm-5.3-flash`) instead of the adapter's slot name.
- **Tests.** `agents.test.ts` checks the environment against a parent full of Anthropic, Claude, AWS and OpenAI credentials; `test/acp-zai.test.ts` runs the provider and the probe against the fake agent (`#env` reports variable names, never values) and checks that the key is in no output, protocol message or stderr record; `test/zai-setup.db.test.ts` covers verification, errors, test messages, defaults, disconnect and the cost estimate; `tests/browser/zai.spec.ts` connects Z.ai in Settings with the fake runtime.
- **Fake runtime.** `createProviders('fake', FAKE_ACP_AGENT, secrets)` passes the worker's secret store, so a Z.ai `#build` turn still needs a stored key. The fake agent gets the ordinary test environment and the GLM model list (`FAKE_ACP_MODELS`), never the key. Browser tests seed the worker's `MEMORY_SECRETS` with a dummy `zai` key; `test/acp-zai.test.ts` runs a fake GLM Builder turn through the approval gate.
- **Live-tested (September 26)** with the user's key, GLM-5.3-Flash at low effort, in a scratch git repo: verify and a test message reached `https://api.z.ai/api/anthropic`; Ask and Do both worked (Do asked once for the write, then made exactly that edit). The adapter and Claude Code processes carried only Z.ai credential variables, `lsof` showed connections only to `api.z.ai`, and the isolated `CLAUDE_CONFIG_DIR` held no `.credentials.json` and no trace of the key in any file, keychain item, protocol message or stderr line.

## Audit recording

S1a records what every agent run says over ACP, for the audit view (S1c).

- **Where it is tapped.** `startAgentProcess` wraps the ndjson stream (`protocol-tap.ts`) when the run passes an audit observer, so every JSON-RPC message in both directions is seen: requests, responses, errors, notifications, and `session/update`s. The worker's recorder (`workflow/audit-recorder.ts`) builds each entry synchronously and writes batches of 50, or every 250 ms, so the agent never waits for the database.
- **What each row holds** (`run_protocol_log`): `seq`, `at` (when the tap saw it), `direction` (`to_agent` / `from_agent`), `kind` (`request`, `response`, `error`, `notification`, `stderr`), `method` (a response is named after its request), `rpc_id`, `size_bytes` (of the original message), the redacted `payload` as jsonb, `truncated`, `prev_hash` and `hash`.
- **Payload cap.** Payloads over 64 KB after redaction are stored as `{ head }` (the first 64 KB of the JSON text) with `truncated: true`; `size_bytes` keeps the original size.
- **Stderr.** Stored as `stderr` rows, split at line ends, up to 1 MB per run. A final row records how many bytes were left out.
- **Lease fencing.** Each batch is written in a transaction that checks the worker's lease, like run events. The recorder is closed before the run's final event, so messages after Stop (`session/cancel`, the `cancelled` reply) are kept. If the lease is lost, the rest is dropped. A failed batch is retried on the next flush.
- **Redaction** (`audit/redact.ts`, before anything is stored): `sk-…` keys, `Bearer …` tokens, `ghp_…`/`gho_…`/`github_pat_…`, AWS access key ids, JWTs, private key blocks, passwords in URLs, `.env`-style `KEY=value` lines whose key looks sensitive, JSON fields named like `apiKey`, `token`, `password`, `secret`, `authorization`, or `credentials` (both in payloads and in JSON text), and the content of secret files (`projects/secret-files.ts`): the reply to an `fs/read_text_file` of one, and the output of any tool call whose input or locations name one. Each becomes `[redacted:<kind>]`.
- **Hash chain.** `hash = sha256(prev_hash + "\n" + canonical JSON of the row)`, per run, starting from no previous hash. `GET /api/runs/:id/audit/verify` walks the chain and reports the first broken row: edited content, a removed row, or a wrong order. Removing rows from the end can't be detected yet.
- **Metrics on `runs`:** `used_model`, `used_effort`, `used_mode` (from the applied session settings), `duration_ms`, `tool_call_count` (agent `tool_call` updates), and `cost_source`. Codex input tokens include cached ones, so an estimate charges `input − cached` at the input price, `cached` at the cached price, and `output` (which includes reasoning) at the output price.
- **Retention.** `AUDIT_RETENTION_DAYS` (90 by default). Right after the API starts listening it deletes the protocol log of runs that finished longer ago and sets `runs.protocol_log_pruned_at`; the run and its metrics stay.
- **API.**
  - `GET /api/runs/:id/audit/log?after=&limit=&direction=&method=&q=`: `{ entries, nextAfter }`, oldest first; `limit` is at most 500 and `q` searches the payload text
  - `GET /api/runs/:id/audit/verify`: `{ runId, intact, checked, firstBrokenSeq, reason, pruned }`
  - `GET /api/conversations/:id/audit/summary`: totals, `byProvider`, `byModel`, and `runs`, with tokens in, out, cached, and thinking, cost, and `costSource` (`mixed` in a total that has both)
  - `GET /api/conversations/:id/audit/export.jsonl`: a streamed download, one `run` line per run followed by its `log` lines, then the decision audit (below)
  - `GET /api/conversations/:id/audit/export.csv`: one row per run with role, model, effort, mode, tokens, `cost_usd`, and `cost_source` (`reported`, `estimated`, or `not_reported`). Cells that start like a spreadsheet formula are prefixed with `'`. With `?view=decisions` it returns the decision audit as one flat table instead
- **Summary run fields for the audit view (S1c):** `role` (derived from `runs.mode` until roles exist: Do is Builder, Ask and Chat are Scout), `runMode`, `userMessageId` (the turn), `startedAt`, `finishedAt`, `approvalWaits` (approvals decided by the user, Stop, timeout, or recovery, and pending ones), and the distinct logged `methods`
- **Estimate prices.** Rates now come from `apps/server/src/model-cards/vendor-cards.json` (`usage/prices.ts` reads them from there), covering the Codex models and Z.ai's `glm-5.3` and `glm-5.3-flash`. GLM usage comes through the Anthropic protocol, where input tokens exclude cache reads and writes, so those prices set `cacheOutsideInput`: input and cache writes at the input price plus cache reads at the cached price. Any other model stays unpriced, so it shows "cost not reported" instead of a guess
- **Decision audit (October 6, 2026; [HARNESS_SIMPLE.md](HARNESS_SIMPLE.md#10-decision-audit-and-export)).** After the `run` and `log` lines the JSONL export adds, in this order: one `meta` line (export version 2, the app version from `SPARK_APP_VERSION`, `harness`, which is `simple`; an export made while the older path still existed may say `current`), one `turn` line per user message (the redacted message text and its length, reply length, agent runs, sessions opened, resumed and replaced, model changes, repeat runs of a role, escalations, Jev calls, cards shown, minutes waited, tiers, and cost split into input, cache write, cache read and output, estimated from token counts and the model cards), one `run_end` line per run (status, end reason, error, tier, cost split), one `session` line per session event, one `jev` line per `run_advice` row (question ids and types, state size, answers, confidence and band, latency, tokens, cost, what was applied and why the rules decided when they did) and one `card` line per approval (kind, title, reason, who decided, minutes waited). A run counts as an agent run when it sent a `session/prompt`, or has no child runs. The message text is already in the log's `session/prompt` payloads, so the turn line carries it after the same secret redaction. Built by `persistence/decision-audit.ts` and `audit/decision-lines.ts`; schemas in `packages/contracts/src/decision-audit.ts`.
- **Session events.** `provider_session_events` (migration 0150) holds one row per open, resume, replace, model change and close, with the reason, the tokens carried and the estimated cache-write cost. Opens, resumes, replacements and model changes are written by `workflow/turn-session.ts`; every close, including the idle sweep, eviction, archive and task close that happen outside a run, is written by a trigger on `provider_sessions`. A run that opened a session nobody keeps (a Critic, a piece's first turn without a key) has no row; the export derives a `one-off session` line from its `session/new` request. `provider_sessions` also stores the model and mode last applied to the session.
- **Smaller log rows.** A repeated, identical `available_commands_update` in one run is stored as a short marker (`repeatsPrevious`, `commandCount`) with the original `size_bytes`; the row count, order and hash chain are unchanged. The account email in `_auth/status_update` is stored as `[redacted:account_email]`. Per-chunk `agent_message_chunk` rows are still stored one per chunk, each with its JSON-RPC envelope: merging them would change the row count the chain and the audit view rely on, so that size cost remains.
- **One session per chat and provider** is described in [HARNESS_SIMPLE.md](HARNESS_SIMPLE.md#sessions). The mode applied to a session is compared with the mode the agent reports back, and a mismatch stops the run before the prompt.
- **Client version.** `clientInfo.version` at `initialize` is `SPARK_APP_VERSION` when the desktop app sets it, and `0.0.0` in development.
- **Not recorded:** the capability probe's messages, stderr that arrives after the process is killed, and anything a provider does outside ACP. The fake provider records no protocol messages.

## Attachments

- **Upload.** `POST /api/attachments` takes the raw file as the body (up to 5 MB) with its URI-encoded name in `X-File-Name`, and returns an `Attachment`. The route sits before the JSON parser and skips the JSON content-type rule; the host and origin checks still apply, and the required custom header forces a CORS preflight.
- **Accepted files.** Images are PNG, JPEG, GIF, or WebP whose magic bytes match the declared type (≤ 5 MB). Anything else must be valid UTF-8 with no NUL bytes (≤ 512 KB) and is stored as text; unknown media types become `text/plain`. Names are reduced to a clean base name.
- **Sending.** `attachmentIds` on a send links unsent attachments from the same workspace to the new message inside the send transaction; a missing or already-sent id fails the whole send with 400. Unsent uploads older than a day are pruned when the API starts.
- **Serving.** `GET /api/attachments/:id/content` returns the bytes with `nosniff`, a sandboxing CSP, and text served as `text/plain`.
- **Prompt.** The current message's attachments are always sent. Attachments on the last three user turns of history are resent; older ones appear as `[Earlier attachment: name]`. Images become ACP `image` blocks. Text becomes a `resource` block when the agent reports `promptCapabilities.embeddedContext`, otherwise a fenced text block. If the agent does not report `image` support, an image on the current message fails the run with a readable error and history images are named only.
- **Budget.** Text attachment bytes count toward the 36 KB history budget: the current message's text files shrink the budget, and a history turn's size includes its text files. Images do not count.

## Agent activity

The mockup's work log ("Worked for 18s", a list of steps) is built from ACP session updates:

| ACP update                                 | Shown as                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `agent_thought_chunk`                      | a "Thinking" step that closes when reply text starts                                         |
| `tool_call` / `tool_call_update`           | a step named by the tool title. Absolute paths are shortened to file names and shown as code |
| `plan`                                     | one step per plan entry, finished when the entry is completed                                |
| `notice`, `session_info_update` (warnings) | a "Warning: …" or "Note: …" step                                                             |
| declined permission                        | a "Declined: …" step                                                                         |

Steps are stored as AG-UI `STEP_STARTED` / `STEP_FINISHED` run events. The conversation detail returns each run's step names (`activity`), so finished turns keep a collapsed "Worked for Ns", "Stopped after N steps", or "Failed after N steps" log. The live turn shows it open, with a spinner on the running step.

In a chat there is little to show: Claude's built-in tools are off, so a Claude chat usually has no steps beyond the `spark` MCP server's own tool calls (see [REPO_AGENT_CONFIG.md](REPO_AGENT_CONFIG.md#sparks-own-tools-spark-mcp-server)). Codex shows thinking and sometimes a plan. Most activity arrives with the project-folder path.

## Spike findings (claude-agent-acp 0.81.2, codex-acp 1.13.1, SDK 1.5.0)

|                           | Claude                                                                                                                                                                                                                                                                                                                       | Codex                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cold start to first token | about 8–10 s. Most of it is SDK start-up, including a 5 s `claude auth status` wait                                                                                                                                                                                                                                          | about 4–9 s                                                             |
| Config options            | mode, model, effort (`thought_level`), fast mode                                                                                                                                                                                                                                                                             | mode, collaboration mode (plan), model, `reasoning_effort`, fast mode   |
| Modes                     | default (Manual), acceptEdits, plan, auto, bypassPermissions                                                                                                                                                                                                                                                                 | read-only ("Ask for approval"), agent (default), agent-full-access      |
| Permission requests       | `tool_call` pending → `session/request_permission` with allow once, allow always, reject → `tool_call_update` failed                                                                                                                                                                                                         | only for actions outside its sandbox                                    |
| Tool calls                | title, kind, locations, diff content, `rawInput`                                                                                                                                                                                                                                                                             | title, kind, diff content, `rawOutput` with exit code                   |
| Thinking                  | summaries as `agent_thought_chunk`: Spark starts the CLI with `--thinking-display summarized` (`extraArgs`, added in `sessionMeta` for the Claude agent only; Z.ai sessions are left as they were). The adapter's default for recent models is omitted text. The flag sets display only; how much Claude thinks is untouched | `agent_thought_chunk` summaries                                         |
| Usage                     | `usage_update` (context used and size, cost in USD), plus usage on the stop response                                                                                                                                                                                                                                         | `usage_update` (context used and size), plus usage on the stop response |
| Cancel                    | stops with `cancelled` in under 60 ms                                                                                                                                                                                                                                                                                        | stops with `cancelled` in under 30 ms                                   |
| Session resume and load   | both advertised; resume verified across processes, used by M6                                                                                                                                                                                                                                                                | both advertised; resume verified across processes, used by M6           |

## Interrupted turns spike (October 5, 2026)

Live providers through `createAcpProvider` in a throwaway repo (claude-agent-acp 0.81.2 with Claude Agent SDK 0.3.280 and Claude Code 2.1.282, model Haiku 4.5; codex-acp 1.13.1 with `@openai/codex` 0.156.1 and codex-cli 0.157.0, model 6 Luna · low; ACP SDK 1.5.0). The agent process was killed with `SIGKILL` mid-turn, then a new process sent `session/resume` with the stored id and a short "you were interrupted" message. This is separate from the fake-agent tests.

| Killed                                   | Claude                                                                                  | Codex                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| While text was streaming                 | Resumed; recalled a codeword from before the kill; read the file state before answering | Resumed; recalled the codeword; still obeyed an instruction from the killed turn           |
| While a command ran (`sleep 20 && echo`) | Resumed; checked `notes.txt` first, saw the command never finished, then ran it once    | Resumed; saw the command never finished and said it would need to rerun it; did not rerun  |
| Right after a command finished           | Resumed; saw the command's effect on disk and did not run it again                      | Not run (turn budget); expected to be the easier case since the call and result are stored |

No resume call failed and no transcript repair was needed. One oddity on Claude: on resume the adapter reported the session's model as Haiku (read from the transcript), Spark therefore sent no `session/set_config_option`, and usage (a 1M context size and 15 to 20 times the cost) suggests the turn ran on the account default model instead. Not fixed here.

## Chat lockdown and known limits

- **Claude:** built-in tools are turned off (`_meta.claudeCode.options.tools: []`, `strictMcpConfig`), so a chat cannot read or write files or run commands beyond the `spark` MCP server every session gets (see REPO_AGENT_CONFIG.md). Without a note in the prompt, Claude wrote fake tool-call markup as text. The prompt now says the chat has no project folder and no tools of its own.
- **Codex:** chats use the patched `read-only` mode, a real `readOnly` sandbox with no network (see "Session (Codex)" above and [PATCHES.md](PATCHES.md)). For chats, Spark Outpost also:
  - sets `INITIAL_AGENT_MODE=read-only`
  - points `TMPDIR` at the run's private folder
  - turns off the shell, unified exec and web search through `CODEX_CONFIG`
  - declines every permission request

- The user's global `~/.codex/config.toml` (for example `approval_policy = "never"`) does not loosen chats, because codex-acp sends its sandbox policy on every turn.
- API-key connections for Claude and Codex are refused with a clear message. The adapters support `ANTHROPIC_API_KEY`, and `CODEX_API_KEY` or `OPENAI_API_KEY`, but that path isn't wired or tested yet. Z.ai is the only key-only agent (below).

## Agent warnings and errors

- Spark Outpost declares ACP `session.notices` and the `sessionFailure` extension (`_meta.jetbrains.air`) at `initialize`. Without them, codex-acp sends warnings and errors as ordinary reply text, and a failed turn looked like a successful answer.
- Notices appear as steps in the work log, for example "Warning: Reconnecting... 2/5" or "Error: …". As the session notices RFD requires, an `error` notice is advisory and never fails the run (changed September 27); a failure comes from the stop reason, a JSON-RPC error or `sessionFailure`. Neither pinned adapter sends `error` notices.
- With the extension on, codex-acp records a terminal error without sending it, so the turn just ends. The provider therefore treats a turn that ends with no reply text as a failure: "{Agent} finished without a reply…", which suggests checking its login.
- Seen on September 25, 2026: Codex's ChatGPT login began returning 401 from `chatgpt.com/backend-api/codex/responses`, for the user's own `codex` CLI as well. Running `codex logout && codex login` is the fix. It is not a Spark Outpost setting.

## Tests

- `pnpm test` covers update mapping, config planning, the permission policy, the conversation prompt, the channel, the ACP provider against `test/fake-acp-agent.ts` (streaming, config, permission, cancel, crash, auth, refusal), project reads and writes, the path policy, and approval decisions (mode posture, run rules, allowlist, safe reads and installs) including a fake Codex Do agent.
- `test/acp-model-access.test.ts` runs the provider and the probe against a fake agent that lists a restricted model set, pushes a ChatGPT account and rejects a model with the exact Codex body or the Claude `errorKind`. `test/model-access.db.test.ts` and `test/model-access-crew.db.test.ts` cover the picker data, the flagged default, routing, the single retry, no retry after a tool call, a restart, and the retry-one-tier-up path.
- `pnpm test:db` covers the approval gate end to end (run rules, races, payload hashes, Stop, timeout, revert in and outside git), a Codex-only crew in place and in a worktree, run input, and project/attachment routes.
- `pnpm test:live` runs the installed Claude and Codex logins: a temp-repo edit, `ls`, a blocked `git push` with revert; Codex Do at each level with an approval receipt on every tool call; conversation-context recall; a blocked write outside the sandbox; and a cancel mid-reply. Set `SPARK_LIVE_DIR` to keep its repos in a scratch folder. It uses a small amount of each account's usage.
- Audit tests cover redaction, protocol entries, the hash chain, the recorder, price estimates, storage, paging, tamper detection, pruning, the summary and the export.

## Known gaps against the ACP spec

From a review of the v1 spec pages (prompt turn, content, elicitation, session modes, session config options, file system). The September 27 compliance audit is in [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md).

Handled:

- **Modes and models.** `legacy-options.ts` turns the legacy `modes` and unstable `models` fields into mode and model options when no config option of that category exists. Config options stay preferred. The safe mode is set with `session/set_config_option` or, for legacy agents, `session/set_mode`. SDK 1.5.0 has no `session/set_model`, so a legacy model choice falls back to the agent default with a visible note.
- **Fresher options.** `applySessionSettings` returns the options from the last `set_config_option` and a capability report built from them, keeping the default model from `session/new`.
- **Mode changes.** `current_mode_update` and the mode in `config_option_update` are checked against the modes the run may use (no worktree-only mode on the checkout, only read-only in Ask). A run in the chat's own worktree (the default for Do chats in git projects since September 29, 2026) counts as a worktree run (`ProviderTurn.worktree`), so worktree-only modes are allowed there. Leaving it adds a `Warning: … switched to … mode` step and `unsafeModeChange()` reports it so the provider can stop the run.
- **Failed tools** close their step and add a `Failed: {step}` step. The web work log folds that into the tool row and shows it as failed, live and after reload.
- **Cancel.** `finish(true)` leaves unfinished tool and plan steps open, so the work log shows them as not finished.
- **Plan updates** replace the whole plan. Entries that disappear are closed, `in_progress` entries stay open.
- **Rate limits** (code or status 429, or rate-limit text in the message, error data, or session failure) read "{Agent} is rate limited. Try again in a minute."
- **Resource links** with an `http` or `https` URI are written as markdown links.
- **Work without text.** `didWork()` is true after a tool call or a declined permission, so the provider can avoid the sign-in hint.

- **Command output.** See "Command output in the chat" below.

Still open: tracked surface by surface in [ACP_COVERAGE.md](ACP_COVERAGE.md#to-reach-full-support).

## Command output in the chat (October 6, 2026)

A command an agent runs (`tool_call` with `kind: execute`) shows its output in a small read-only terminal in the reply. Spark still advertises `terminal: false` and no `terminal_output` extension: neither pinned adapter calls `terminal/create`, so owning the terminal would change nothing, and commands keep running in the agent's own process, in the folder the session already uses.

| Agent                                     | What the adapter sends                                                                                                                                                                                                                                                           | Shown                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Codex (codex-acp 1.13.1)                  | `tool_call` with the command as title, `_meta.terminal_info.cwd` and `rawInput.cwd`; one `tool_call_update` per output delta with `_meta.terminal_output_delta.data`; a last update with `status`, `_meta.terminal_exit.exit_code` and `rawOutput.{formatted_output, exit_code}` | Live, with the real exit code. Codex caps what it forwards for a very noisy command. |
| Claude and Z.ai (claude-agent-acp 0.81.2) | `tool_call` titled `Terminal` while the input streams, then updates with the command as title; `in_progress` heartbeats without output; a last update with `status` and the output as a fenced text block (a failed one starts with `Exit code N`) and as `rawOutput`            | When the command ends. The exit code is known only for a failed command.             |

- **Mapping.** `agents/acp/command-output.ts` turns those updates into `command_started`, `command_output` and `command_finished` provider outputs. It waits for the command text before starting, so Claude's placeholder title is never shown. `streamsCommandOutput` on the agent definition says whether to expect live output.
- **Recording.** `workflow/command-recorder.ts` strips every escape sequence except colours, line erase and simple cursor moves (`createOutputSanitizer` in `packages/contracts/src/command-runs.ts`: no OSC, so no title, clipboard or hyperlink; no queries; no mode changes), then runs the same redaction as reply text (`createRedactionFilter` with the project's secret values). Only that cleaned text is stored or sent anywhere. The command line is redacted too.
- **Events.** `CUSTOM` run events `command_started`, `command_output` (`at` is the chunk's position in the cleaned stream, so a repeat or a gap is detectable; `reset` replaces what the browser has) and `command_finished`. Output is batched for 100 ms, at most 32 KB per event and 1 MB per command; past that the live stream pauses and the stored end is sent once when the command ends.
- **Storage.** `run_commands` (migration 0140) keeps the command, folder, status, exit code, place in the reply and the last 64 KB of output, saved about once a second while it runs. A row still `running` when its run has ended reads as `interrupted`, which is how a command cut off by a restart shows what was captured. `GET /api/runs/:id/commands/:commandId/output` serves the stored output; a paired phone may read it like the run's events.
- **Unchanged.** The approval gate, the audit log and its ran-without-review marks, the safety floor, the agent's environment, cancellation and the step list do not read or depend on any of this.

Live check, October 6, 2026, in a throwaway repo under the temp folder with the locally signed-in CLIs: Codex streamed one delta per printed line (10 over 10 s) and reported exit codes 0, 3 and 1; Claude sent nothing until the command ended (11.8 s for the same script) and reported exit code 3 for the failing one; stopping a turn mid-command left an `interrupted` row with Codex's four captured lines and with no output for Claude; a value from the repo's `.env` printed by a script was stored and shown as `[redacted:secret_value]` for both. Codex in Read-only ran the command in its sandbox without a permission request, so the card-to-terminal handoff was seen live only with Claude in Manual.

## Extensibility and other agents

- Our `_meta` use follows the extensibility rules: vendor-namespaced keys in `clientCapabilities._meta` and `session/new._meta`, no custom methods, and no new root fields. `session.notices` is an unstable spec field in SDK 1.5.0 (not ours), so keep the SDK version pinned. The full audit is in [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md). The run and the capability probe share `CLIENT_CAPABILITIES` and `CLIENT_INFO` from `client-info.ts`, so both advertise `sessionFailure` and notices.
- **Gemini CLI** (`gemini --acp`) as another provider needs:
  - model selection through `unstable_setSessionModel` once the SDK exposes it. The legacy `modes` and `models` fallback already covers mode switching and model capabilities.
  - a per-run config that turns off the user's MCP servers and local file tools. It adds servers from `~/.gemini/settings.json` even when we pass none, and reads the disk directly when client fs is off.
  - usage read from the prompt response's `_meta.quota`
  - prompts that never start with `/` or `$`, which it treats as commands

## Next

1. **Codex Do upstream.** Filed as codex-acp issues #555 and #556, draft PRs #557 and #558; see [PATCHES.md](PATCHES.md) for status.
2. **Elicitation.** Advertise `elicitation.form` and show `elicitation/create` as a card that answers `accept`, `decline`, or `cancel`. The spec forbids form mode for secrets.
3. **Richer activity.** Show diffs and file locations from tool-call content, failed and cancelled steps, and the plan as a checklist.
4. **A warm agent process per provider** (F-18) is still deferred: resume works across new processes, so it would only save process start.
5. **API-key runs.**
