# ACP agents

How Spark Outpost runs Claude, Codex and Z.ai (GLM) through the Agent Client Protocol, what the September 25, 2026 spike found, and the limits that remain.

## What runs today

This is the harness's **simple path**: a chat without a linked project folder. One agent session answers from the saved conversation. There is no planner or reviewer yet.

```
message → run (Postgres) → worker claims job → ACP provider
  spawn agent → initialize → session/new (empty private folder) → session/set_config_option
  → session/prompt (chat note + saved history + message) → session/update stream → steps and text
  → stop reason → run finished, failed, or cancelled
```

- **Processes and sessions.** The worker starts `claude-agent-acp` or `codex-acp` from the server's dependencies, over stdio. A chat without a project works in a folder under `$TMPDIR/spark-outpost-sessions` (`SESSION_WORKDIR_ROOT`), and a later turn resumes the chat's agent session when it can (M6, `workflow/session-decision.ts`).
- **Context.** A fresh session gets the conversation from Postgres, the source of truth; a resumed session gets only the new message. Up to 36 KB of the newest messages are included, and the prompt says how many older ones were left out. Messages are not summarized yet.
- **Settings.** The run first forces the chat mode, then applies the connection's model and effort through config options. Model and effort are matched by value first, then by display name. If a value isn't offered, the run adds a visible step saying the agent's default is used. If the chat mode can't be applied, the run stops before the prompt is sent.
- **Permissions.** Every permission request is declined with the agent's reject-once option, and the work log records a "Declined: …" step. A request that arrives after Stop is answered with the `cancelled` outcome, as the spec requires.
- **Cancel.** Stop sends `session/cancel`. The process is killed if the agent hasn't stopped within 5 seconds.
- **Errors.** Errors are turned into readable messages:
  - not signed in (ACP `auth_required`)
  - process exit
  - refusal
  - turn limit
  - failed start

  Agent stderr is kept in the run's audit log (redacted, up to 1 MB), never shown in the chat.

- **Provider choice.** A chat uses the provider picked in its composer, or the profile's default provider. The API refuses to queue a run when no provider is connected. Browser tests set `AGENT_RUNTIME=fake`, which routes `claude` and `codex` to the fake provider. With `FAKE_ACP_AGENT` set to `apps/server/test/fake-acp-agent.ts`, turns whose prompt contains `#build` go to that fake ACP agent instead, so the real orchestrator runs its Architect, Builder and Critic roles through the ACP adapter and the approval gate.
- **New chats are drafts.** New chat only makes an id in the browser. The conversation is saved in the same transaction as its first message, and it takes its title from that message's first line. Chats without messages are left out of the list, and the API deletes those older than a day when it starts.

Code:

- `apps/server/src/agents/acp/`
- `apps/server/src/workflow/run-input.ts`
- `apps/server/src/workflow/providers.ts`

## Ask in project folders (M1)

A chat can be linked to one or more project folders (repos) with `PATCH /api/conversations/:id/settings {projectIds}`. The list is ordered and the first repo is the primary one. Links live in `conversation_projects (conversation_id, project_id, position)`. Its runs are in Ask mode: the agent may read inside the folders but not change anything. See [agent adapters](AGENT_ADAPTERS.md) for what each adapter really does.

- **Session (Claude).** `cwd` is the primary repo's real root; the agent process also starts there. The other repos go in `session/new.additionalDirectories` (absolute paths) only when `initialize` advertises `agentCapabilities.sessionCapabilities.additionalDirectories`. claude-agent-acp 0.81.2 advertises it. When an agent doesn't, the run keeps only the primary repo and adds a step such as "Claude can only open one repo per chat; using spark-outpost". If a root is gone, the run fails with a readable error naming it.
- **Session (Codex).** codex-acp 1.13.1's `read-only` mode is really a workspace-write sandbox rooted at `cwd`. We patch it (`patches/@agentclientprotocol__codex-acp@1.13.1.patch`, the same change as upstream [codex-acp#480](https://github.com/agentclientprotocol/codex-acp/pull/480)) so `read-only` is a `readOnly` sandbox: no writes, no network, reads allowed. Codex project runs start in the primary repo with `shell_tool` on, and get the other repos as `additionalDirectories`, which stay read-only because the adapter only widens `workspaceWrite` policies. A unit test fails if the patch is missing. Known gap: Codex's sandbox can read the whole disk, including secret files, so our secret-file list doesn't bind Codex. Remove this part of the patch when a codex-acp release includes #480; every patch part, its guard tests and the upgrade checklist are in [PATCHES.md](PATCHES.md).
- **Prompt.** The chat-only note is replaced by a note listing every linked folder, marking the primary one, and saying the agent may read files in them but must not change files or read outside them. Codex runs keep the chat-only note.
- **Spark instructions.** Every session, with Spark on or off, also gets a short "Working with the user" block from `agents/acp/spark-instructions.ts`: the coordinator (team) line, the user's first name when one is saved, and a tone line. Claude and Z.ai get it in `_meta.systemPrompt.append` (and the Agent tool when the session has tools), Codex in `developer_instructions`. None of it is a user setting any more; see HARNESS_PLAN "Spark simplified".
- **Client file system.** Only runs that read folders advertise `fs.readTextFile: true`; `writeTextFile` stays false.
  - `fs/read_text_file` goes through `projects/path-policy.ts` across all linked roots: absolute paths only, lexically and after `realpath` inside one of the roots (the closest root wins for nested repos, and every containing root's rules apply), secret files refused (the list in `projects/secret-files.ts`: `.env` and `.env.*` except `.env.example`, SSH keys `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa` and their `.pub` files, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credential(s)` files, plus each root's `.sparkignore` entries), 1 MB cap. Relative paths resolve against the primary root. `line` (1-based) and `limit` are honoured. A read adds a "Read `relative/path`" step (prefixed with the repo name when several are linked); a refusal adds "Refused `path` (reason)" and answers `invalid_params`; a missing file answers `resource_not_found`.
  - `fs/write_text_file` isn't advertised, so a call is answered `method_not_found` (-32601) with a "Declined: Write `path` (…)" step.
- **Permissions.** In Ask, requests are still declined with reject-once; in a project the step says "Ask mode only reads files; switch to Do to allow changes". The safe-mode lock is unchanged. Do mode is described below.
- **How Claude reads.** claude-agent-acp 0.81.2 never calls `fs/read_text_file`; it reads the disk with its own tools. Project runs get `tools: ['Read', 'Glob', 'Grep']` in `default` mode, and every Claude session (chat or project) is hardened through `_meta.claudeCode.options`:
  - `settingSources: []`, so the repo's and user's hooks, `env` and `apiKeyHelper` aren't loaded
  - `allowDangerouslySkipPermissions: false` and `settings.permissions.disableBypassPermissionsMode: 'disable'`
  - `settings.permissions.blockReadsOutsideWorkingDirectories: true`
  - deny rules built from `projects/secret-files.ts`, in both `disallowedTools` and `settings.permissions.deny`, as `Read(**/<pattern>)` plus `Read(//<extra repo>/**/<pattern>)` for each extra repo. Claude's rules can't express exceptions, so `.env.example` stays denied for Claude even though our path policy allows it.
- **Known gaps:** Claude's tools bypass our path policy; its deny rules, Grep/Glob coverage and outside-folder behaviour are unverified until the live test runs. Per the September 25 decisions, M1 ships without `sandbox-exec`.
- **Default repos.** A new chat starts with the repos most recently chosen for any chat (`workspace_settings.default_project_ids`, updated whenever a chat's repos change to a non-empty list). `GET /api/default-projects` returns them for drafts, and the server copies them into `conversation_projects` when the chat row is first created. Choosing "No project" leaves the chat empty and keeps the default.
- **API.** `GET /api/folders?path=` (picker, default `$HOME`), `GET/POST /api/projects` (each with `displayPath`, the root with `~` for the home folder), `PATCH /api/projects/:id {name?, commandAllowlist?}` (rename or allowlist), `DELETE /api/projects/:id` (removes the project from Spark Outpost only, never the folder; returns `{project, links}` so `POST /api/projects/restore` can undo it with the same id and chat links), `GET /api/projects/:id/git` (`{branch}`, from `git symbolic-ref` with a short-SHA fallback and a 2 s timeout; `null` outside git), `GET /api/projects/:id/files?query=` (up to 50 matches from `git ls-files --cached --others --exclude-standard`, or a bounded walk outside git; secrets left out), `POST /api/projects/:id/attachments {path}` (text files up to 512 KB, stored with `source_path`). The web app searches every linked repo and merges the results.

Code: `apps/server/src/projects/`, `apps/server/src/persistence/conversation-projects.ts`, `apps/server/src/agents/acp/fs-handlers.ts`, `apps/server/src/agents/acp/session-request.ts`, `apps/server/src/api/project-routes.ts`.

## Do in project folders (M2)

A chat linked to a project runs in Do mode when its agent mode (`overrides[provider].agentMode`, default from `provider_connections.agent_mode`) is not read-only; the harness autonomy is `.level`, defaulting to `profiles.default_level`. The run records `runs.mode` (`chat`, `ask`, `do`), `runs.agent_mode` and `runs.level`. See [HARNESS_PLAN.md](HARNESS_PLAN.md#m2-status-september-26-2026) for the decision rules.

- **Claude.** Same hardening as Ask, with `tools: ['Read','Glob','Grep','Edit','Write','Bash']` and `settings.permissions.ask: ['Bash','Edit','Write']`, so even read-only commands like `ls` reach `session/request_permission`. The chosen Claude mode is applied; Do sessions let the adapter offer Bypass permissions, and the ask rules keep every edit and command at the gate in every mode (HARNESS_PLAN, "Safety floor under the permissive modes"). The prompt note says the agent may change files and that a denied action must not be retried another way.
- **Codex** (since September 26, [CODEX_DO.md](CODEX_DO.md)). Our codex-acp patch adds the mode `ask-every-action`:
  - `approvalPolicy: "untrusted"` with approvals reviewed by the user
  - a `workspaceWrite` sandbox with no network and no `/tmp`; the run's private `TMPDIR` stays writable
  - a `decline` option on command and file-change requests, so a denied action lets Codex continue instead of ending its turn

  `ask-every-action` is Codex's asking mode (`AgentDefinition.doMode`): Ask every time uses it, and it is the fallback when a chosen mode is unavailable. A live switch to a mode the run may not use stops the run. Live, every command, including `ls`, `cat` and `git status`, and every `apply_patch` reached `session/request_permission`, so `decide()` sees each action. Codex Do opens only the primary repo (`doPrimaryRootOnly`, because extra folders would become writable roots) and adds a step saying so. Approve for me and Full access skip the gate, so they run only in a git worktree copy (`modeNeedsWorktree`, `orchestration/solo-copy.ts`); Ask every time runs where the autonomy puts it, and every Full auto → PR Builder uses a worktree.

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
  - `usage_update` gives context used, window size, and cost in USD. Cost is cumulative for the session, and each run has its own session, so the latest value is the run's cost.
  - The `session/prompt` response's `usage` gives input, output, total, cached read and write, and thinking tokens.
  - Each finished reply shows its tokens and cost, with a breakdown on hover or focus. The run's `usage.costSource` says whether the cost is `reported` or `estimated`; the web app does not label estimates yet.
  - The conversation detail includes `usageTotals`: the chat's cost and tokens, and per provider its runs, cost, tokens, and last context reading.
  - The composer's context ring shows the current provider's last context reading, plus the chat totals and per-provider lines when more than one provider was used.
  - `GET /api/usage/summary` totals runs, cost, and tokens per provider for the last 30 days and all time. Settings shows them under Usage.
- **Tests without real agents.** With `AGENT_RUNTIME=fake`, the API returns a fixed fake capability snapshot and the fake provider reports usage, so browser tests never start real agents.

## Z.ai (GLM) (September 26, 2026)

Z.ai is a third provider, `zai`, named "Z.ai (GLM)". It runs the same `claude-agent-acp` against Z.ai's Anthropic-compatible endpoint, so Claude Code is the agent and GLM is the model. The Z.ai docs we rely on are summarised in [GLM_NOTES.md](../reference/zai/GLM_NOTES.md).

- **Connection.** API key only (`methods: ['api_key']`). The key is verified with one `POST {ZAI_BASE_URL}/v1/messages` to `glm-5.3-flash` with `max_tokens: 16` (Bearer auth), stored in the OS keychain as `zai:api_key` like the other keys, and shown masked (`…abcd`). The terminal and CLI verification refuse `zai`. Z.ai error codes are explained (1113 no balance or plan, 1302/1305 rate limit, 1308–1321 plan quota).
- **Clean launch** (`agents/acp/zai.ts`, `agent-env.ts`). The worker reads the key from the secret store at run time and builds the environment from an allowlist (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TMPDIR`, `TERM`, `TZ`, CA and proxy variables), not from the server's environment. Nothing named `ANTHROPIC_*`, `CLAUDE_*`, `AWS_*` or `OPENAI_*` is inherited. It then sets:
  - `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `ANTHROPIC_AUTH_TOKEN=<key>`
  - `ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL=glm-5.3[1m]` and `ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash[1m]`, each with `_NAME` and `_DESCRIPTION`, so the picker and Jev see "GLM-5.3" and "GLM-5.3-Flash" with strengths and prices
  - `API_TIMEOUT_MS=3000000`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, as the Z.ai docs recommend
  - `CLAUDE_CONFIG_DIR` set to an isolated, `0700` config home (`$TMPDIR/spark-outpost-zai-claude`). Claude Code then reads no `~/.claude` settings, plugins or `.credentials.json`, and its keychain item name gets a hash suffix of that directory, so the user's `Claude Code-credentials` login is never looked up. The directory is shared by Z.ai runs so session resume works.
- **No fallback to the Claude login.** Besides the clean environment, `claude-agent-acp` runs with `--hide-claude-auth`, which refuses any session whose account would bill a claude.ai subscription.
- **Same hardening as Claude.** The Z.ai definition reuses Claude's session options: `settingSources: []`, the secret-file deny rules, `allowDangerouslySkipPermissions: false`, bypass disabled, `blockReadsOutsideWorkingDirectories`, the `default` mode lock, and Do with `ask: ['Bash','Edit','Write']` through the approval gate.
- **Models and effort.** The adapter offers `default`, `opus`, `sonnet`, `haiku` and `claude-fable-5-1`. `offers` keeps only `opus` (GLM-5.3) and `haiku` (GLM-5.3-Flash), and the efforts Low, High and Max (GLM-5.3 has only these levels; High is the default). The probe and each run's capability report are filtered the same way, and the probe with the key spends nothing.
- **Cost and model records.** Claude Code's reported cost uses Anthropic prices, so a Z.ai run drops it (`estimatesCost`), and the run is priced from its tokens at the GLM rates with `cost_source: 'estimated'`. `used_model` records the GLM model (`glm-5.3`, `glm-5.3-flash`) instead of the adapter's slot name.
- **Tests.** `agents.test.ts` checks the environment against a parent full of Anthropic, Claude, AWS and OpenAI credentials; `test/acp-zai.test.ts` runs the provider and the probe against the fake agent (`#env` reports variable names, never values) and checks that the key is in no output, protocol message or stderr record; `test/zai-setup.db.test.ts` covers verification, errors, test messages, defaults, disconnect and the cost estimate; `tests/browser/zai.spec.ts` connects Z.ai in Settings with the fake runtime.
- **Fake runtime.** `createProviders('fake', FAKE_ACP_AGENT, secrets)` passes the worker's secret store, so a Z.ai `#build` turn still needs a stored key. The fake agent gets the ordinary test environment and the GLM model list (`FAKE_ACP_MODELS`), never the key. Browser tests seed the worker's `MEMORY_SECRETS` with a dummy `zai` key; `test/acp-zai.test.ts` runs a fake GLM Builder turn through the approval gate.
- **Live test (September 26, with the user's key, GLM-5.3-Flash at low effort, in a scratch git repo):**
  - The app's own verify and "Send test message" went to `https://api.z.ai/api/anthropic` (the default `ZAI_BASE_URL`); the test message was answered by `glm-5.3` in 1.5 s.
  - Ask ("what does math.js do?") ran Find and Read and answered in 10.4 s. Do ("make hello.txt read 'hello, GLM'") asked once for "Write hello.txt", was allowed by the gate, and made exactly that edit in 10.3 s.
  - Tokens: 3,490 in, 6,464 cache reads, 102 out for Ask; 6,287 in, 7,680 cache reads, 161 out for Do. Estimated cost $0.0020 in total. The adapter reported no usable cost (dropped as designed); `used_model` was `glm-5.3-flash`. Z.ai reports cache reads through the Anthropic protocol.
  - The adapter and Claude Code processes had only these credential-like variables: `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `CLAUDE_CONFIG_DIR` set to the isolated directory; no `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` or other `CLAUDE_*` login variables. The adapter ran with `--hide-claude-auth`.
  - `lsof -i` on the adapter's process tree, sampled every 0.3 s, showed connections only to `api.z.ai` (8.221.126.63 and 240b:4002:109:2b8:5400::202a); none to Anthropic's 160.79.104.10 or 2607:6bc0::10.
  - The isolated config dir held `.claude.json` (no account fields), backups, session transcripts and no `.credentials.json`; no file in it contained the key, no keychain item exists for it, and the key appeared in no protocol message or stderr line.

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
- **Retention.** `AUDIT_RETENTION_DAYS` (90 by default). When the API starts it deletes the protocol log of runs that finished longer ago and sets `runs.protocol_log_pruned_at`; the run and its metrics stay.
- **API.**
  - `GET /api/runs/:id/audit/log?after=&limit=&direction=&method=&q=`: `{ entries, nextAfter }`, oldest first; `limit` is at most 500 and `q` searches the payload text
  - `GET /api/runs/:id/audit/verify`: `{ runId, intact, checked, firstBrokenSeq, reason, pruned }`
  - `GET /api/conversations/:id/audit/summary`: totals, `byProvider`, `byModel`, and `runs`, with tokens in, out, cached, and thinking, cost, and `costSource` (`mixed` in a total that has both)
  - `GET /api/conversations/:id/audit/export.jsonl`: a streamed download, one `run` line per run followed by its `log` lines
  - `GET /api/conversations/:id/audit/export.csv`: one row per run with role, model, effort, mode, tokens, `cost_usd`, and `cost_source` (`reported`, `estimated`, or `not_reported`). Cells that start like a spreadsheet formula are prefixed with `'`
- **Summary run fields for the audit view (S1c):** `role` (derived from `runs.mode` until roles exist: Do is Builder, Ask and Chat are Scout), `runMode`, `userMessageId` (the turn), `startedAt`, `finishedAt`, `approvalWaits` (approvals decided by the user, Stop, timeout, or recovery, and pending ones), and the distinct logged `methods`
- **Estimate prices.** `usage/prices.ts` holds OpenAI's Standard short-context rates for the Codex models (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`), from https://developers.openai.com/api/docs/pricing, and Z.ai's pay-as-you-go rates for `glm-5.3` and `glm-5.3-flash`, from https://docs.z.ai/guides/overview/pricing, both checked 2026-09-26. GLM usage comes through the Anthropic protocol, where input tokens exclude cache reads and writes, so those prices set `cacheOutsideInput`: input and cache writes at the input price plus cache reads at the cached price. Any other model stays unpriced, so it shows "cost not reported" instead of a guess
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

In a chat there is little to show: Claude's tools are off, so a Claude chat usually has no steps. Codex shows thinking and sometimes a plan. Most activity arrives with the project-folder path.

## Spike findings (claude-agent-acp 0.81.2, codex-acp 1.13.1, SDK 1.5.0)

|                           | Claude                                                                                                               | Codex                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cold start to first token | about 8–10 s. Most of it is SDK start-up, including a 5 s `claude auth status` wait                                  | about 4–9 s                                                             |
| Config options            | mode, model, effort (`thought_level`), fast mode                                                                     | mode, collaboration mode (plan), model, `reasoning_effort`, fast mode   |
| Modes                     | default (Manual), acceptEdits, plan, auto, bypassPermissions                                                         | read-only ("Ask for approval"), agent (default), agent-full-access      |
| Permission requests       | `tool_call` pending → `session/request_permission` with allow once, allow always, reject → `tool_call_update` failed | only for actions outside its sandbox                                    |
| Tool calls                | title, kind, locations, diff content, `rawInput`                                                                     | title, kind, diff content, `rawOutput` with exit code                   |
| Thinking                  | none streamed at default effort                                                                                      | `agent_thought_chunk` summaries                                         |
| Usage                     | `usage_update` (context used and size, cost in USD), plus usage on the stop response                                 | `usage_update` (context used and size), plus usage on the stop response |
| Cancel                    | stops with `cancelled` in under 60 ms                                                                                | stops with `cancelled` in under 30 ms                                   |
| Session resume and load   | both advertised; resume verified across processes, used by M6                                                        | both advertised; resume verified across processes, used by M6           |

## Chat lockdown and known limits

- **Claude:** built-in tools are turned off (`_meta.claudeCode.options.tools: []`, `strictMcpConfig`), so a chat cannot read or write files or run commands. Without a note in the prompt, Claude wrote fake tool-call markup as text. The prompt now says the chat has no project folder and no tools.
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

- `pnpm test` includes:
  - unit tests for update mapping, config planning, the permission policy, the conversation prompt, and the channel
  - `test/acp-provider.test.ts`, which drives the real provider against `test/fake-acp-agent.ts` over stdio. It covers streaming, config, permission, cancel, crash, auth, and refusal cases.
  - `test/acp-project.test.ts`, which runs the fake agent in a project folder: `cwd`, advertised capabilities, reads with `line`/`limit`, refused reads (`..`, symlink escape, `.env`), declined writes, and a missing root.
  - `src/projects/path-policy.test.ts` for the path policy and `.sparkignore`.
  - `src/approvals/decide.test.ts` for every mode posture, run rules, the allowlist and the always-ask list; `permission-request.test.ts` for the ACP mapping; `test/acp-approvals.test.ts`, which drives the fake agent in Do mode through allow, deny, cancel on Stop and approved, denied and refused `fs/write_text_file`; `src/approvals/command-kinds.test.ts` for safe reads and installs; `test/acp-codex-do.test.ts`, where the fake agent acts like Codex (`#codex`, `test/fake-codex-do.ts`: every command and patch asks with Codex's option ids, and `cancel` ends the turn).
- `pnpm test:db` includes `test/approvals.db.test.ts` (the gate, run rules, the allowlist, decision races, payload hashes, Stop and the timeout) and `test/approval-runs.db.test.ts` (a worker run through the API decision, Stop while waiting, the timeout failing the run, crash recovery expiring approvals, and revert in and outside git).
- `pnpm test:db` also includes `test/codex-crew.db.test.ts`: a Codex-only crew builds in place with Ask every time at Review each step, and in a merged and removed worktree with Approve for me at Automatic and Full auto → PR.
- `pnpm test:live` includes `test/approvals.live.test.ts`: Claude in a temp git repo edits a file, runs `ls` and tries `git push`, and the run is reverted. `test/codex-do.live.test.ts` runs Codex Do (`gpt-6-luna` · low) at each level and checks that every Codex tool call has an approval receipt. Set `SPARK_LIVE_DIR` to keep its repos in a scratch folder.
- The audit tests: unit tests for redaction, protocol entries, the hash chain, the recorder, and price estimates, and `test/acp-provider.test.ts` checks that every message is recorded in order with a secret in tool output redacted. `test/audit-log.db.test.ts` and `test/audit-api.db.test.ts` cover storage, paging, tamper detection, pruning, a worker run against the fake agent, the summary, and the export.
- `pnpm test:db` covers run input: history, settings, and choosing the provider; `test/projects.db.test.ts` covers the folder picker, projects, file search, and project-file attachments.
- `pnpm test:live` runs the installed Claude and Codex logins. Each provider gets:
  - a conversation-context recall test
  - a blocked file write outside the sandbox
  - a cancel mid-reply that stops within 6 s

  It uses a small amount of each account's usage.

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

Still open:

- Persisted activity for finished runs marks every step done, so cancelled steps only show as not finished while the run is live.
- `tool_call_update` title changes, tool-call `content` (diffs, terminals), `locations`, thought text and `plan_update`/`plan_removed` are ignored. `available_commands_update` feeds the composer's `/` menu (see [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md#slash-commands)). Non-link content blocks in agent messages are dropped.

## Extensibility and other agents

- Our `_meta` use follows the extensibility rules: vendor-namespaced keys in `clientCapabilities._meta` and `session/new._meta`, no custom methods, and no new root fields. `session.notices` is an unstable spec field in SDK 1.5.0 (not ours), so keep the SDK version pinned. The full audit is in [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md). The run and the capability probe share `CLIENT_CAPABILITIES` and `CLIENT_INFO` from `client-info.ts`, so both advertise `sessionFailure` and notices.
- **Gemini CLI** (`gemini --acp`) as another provider needs:
  - model selection through `unstable_setSessionModel` once the SDK exposes it. The legacy `modes` and `models` fallback already covers mode switching and model capabilities.
  - a per-run config that turns off the user's MCP servers and local file tools. It adds servers from `~/.gemini/settings.json` even when we pass none, and reads the disk directly when client fs is off.
  - usage read from the prompt response's `_meta.quota`
  - prompts that never start with `/` or `$`, which it treats as commands

## Next

1. **Codex Do upstream.** Ask codex-acp for an "ask for everything" mode and a continue-on-deny option, so our patch can go.
2. **Elicitation.** Advertise `elicitation.form` and show `elicitation/create` as a card that answers `accept`, `decline`, or `cancel`. The spec forbids form mode for secrets.
3. **Richer activity.** Show diffs and file locations from tool-call content, failed and cancelled steps, and the plan as a checklist.
4. **Faster start:** ~~reuse ACP sessions with `session/resume` when the conversation hasn't changed~~ (done in M6, see HARNESS_PLAN.md). A warm agent process per provider (F-18) is still deferred: resume works across new processes, so it would only save process start.
5. **API-key runs.**
