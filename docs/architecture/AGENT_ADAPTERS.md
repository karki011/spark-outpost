# Agent adapters: what they really do

How the pinned ACP adapters behave, checked against their shipped code, their docs, and our setup. Written September 25, 2026.

- Claude: `@agentclientprotocol/claude-agent-acp` 0.81.2, which bundles `@anthropic-ai/claude-agent-sdk` 0.3.280 (Claude Code 2.1.280).
- Codex: `@agentclientprotocol/codex-acp` 1.13.1, a TypeScript bridge that starts `codex app-server` from `@openai/codex` 0.156.1.
- Our side: `apps/server/src/agents/acp/` (`agents.ts`, `acp-provider.ts`, `client-info.ts`, `permissions.ts`, `apply-settings.ts`).

Paths below are shortened:

- `CA` = `node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.81.2_…/node_modules/@agentclientprotocol/claude-agent-acp/dist`
- `CX` = `node_modules/.pnpm/@agentclientprotocol+codex-acp@1.13.1/node_modules/@agentclientprotocol/codex-acp/dist/index.js`

## Top findings

1. **Codex Ask mode can write to the project.** codex-acp 1.13.1 has no read-only sandbox. Its mode `read-only` ("Ask for approval") is `workspaceWrite` rooted at `cwd`, with `approvalPolicy: on-request` (`CX:32985-32999`). In a project run `cwd` is the project root and `shell_tool` is on, so Codex can edit files and run writing commands in the project **without any `session/request_permission`**. Our decline handler never sees it. `ACP_AGENTS.md:51` ("read inside its read-only sandbox") is wrong.
2. **Claude loads the project's own settings.** The adapter defaults `settingSources` to `["user", "project", "local"]` (`CA/acp-agent.js:6377`). In an SDK session, project hooks, the `env` block and `apiKeyHelper` run without a trust dialog ([permissions: What runs before you trust a folder](https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder)). Opening an untrusted folder in Ask can run its hooks. User settings also apply, so a global `permissions.additionalDirectories` silently widens what Claude reads without asking.
3. **Neither adapter uses client fs or terminal.** Advertising `fs.readTextFile: true` changes nothing for either real agent. Our path policy only protects the fake agent. The supported way to put reads through our policy is an MCP server that we pass in `session/new` (see "Routing reads through us").
4. **codex-acp `main` has a real read-only mode, but it's unreleased.** PR #480 ("restore read-only mode and clarify access presets", September 23) makes `read-only` use `{type: "readOnly"}` and adds `workspace-write` as a separate mode ([AgentMode.ts on main](https://github.com/agentclientprotocol/codex-acp/blob/main/src/AgentMode.ts)). The 1.13.1 changelog ends before it. When we upgrade, the meaning of our `conversationMode: 'read-only'` changes.

## Claude adapter (claude-agent-acp 0.81.2)

| Question                                          | Answer                                                                                                                                                                                                                                       | Source                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `promptCapabilities`                              | `image: true`, `embeddedContext: true` (no audio)                                                                                                                                                                                            | `CA/acp-agent.js:1108-1111`            |
| `sessionCapabilities`                             | `additionalDirectories`, `close`, `delete`, `fork`, `list`, `resume`, `subagents` (all `{}`)                                                                                                                                                 | `CA/acp-agent.js:1086-1094`            |
| `loadSession`                                     | `true`                                                                                                                                                                                                                                       | `CA/acp-agent.js:1123`                 |
| `mcpCapabilities`                                 | `http: true`, `sse: true`, plus stdio (required by the spec)                                                                                                                                                                                 | `CA/acp-agent.js:1112-1115`            |
| auth                                              | `auth.logout`. `authMethods` are terminal logins, offered only if the client advertises `auth.terminal` or `_meta["terminal-auth"]`. Gateway methods are offered only with `auth._meta.gateway`. We advertise neither, so the list is empty. | `CA/acp-agent.js:1014-1085, 1131-1134` |
| Calls `fs/read_text_file` / `fs/write_text_file`? | **No.** Only pass-through methods exist (`:743-747`, `:5450-5456`), for library users. Nothing in the adapter calls them.                                                                                                                    | grep of `CA/*.js`                      |
| Calls `terminal/*`?                               | **No.** Commands run in the Claude Code subprocess. Terminal output is only shown as `_meta.terminal_output` if the client opts in.                                                                                                          | `CA/acp-agent.js:5527`                 |
| Modes offered                                     | `default` (Manual), `acceptEdits`, `plan`, `auto`, `bypassPermissions` (only when not root and not disabled). `dontAsk` can be parsed but isn't offered.                                                                                     | `CA/session-mode.js:190-238`           |
| `_meta.claudeCode.options`                        | Spread into the SDK `Options`. The adapter still controls `cwd`, `permissionMode`, `canUseTool`, `mcpServers` (merged) and `hooks` (merged). `tools` wins over the preset. `disallowedTools` is ours plus `AskUserQuestion`.                 | `CA/acp-agent.js:6255-6425`            |
| Permission flow                                   | The SDK calls `canUseTool` only for calls it would ask about. The adapter turns each into `session/request_permission` (allow once / always / reject).                                                                                       | `CA/acp-agent.js:5552-5680`            |

### Claude: reading a folder

- **`tools: ['Read','Glob','Grep']` + `disallowedTools: ['Read(**/.env)', …]`.** Mostly works as intended.
  - `tools` is the base set of built-in tools. Anything not listed (Bash, Edit, Write, WebFetch, Agent…) is removed from the model's context (SDK `sdk.d.ts:1563-1575`).
  - `disallowedTools` entries with a specifier become deny rules. Patterns are gitignore-style and relative to `cwd`, so `**/.env` matches at any depth under the project ([permissions: Read and Edit](https://code.claude.com/docs/en/permissions#read-and-edit)).
  - Gaps:
    - `**/.env.*` also blocks `.env.example`, which our path policy allows.
    - The list is missing `.pgpass`, `.pypirc`, `.git-credentials`, `credentials*`, `*.p12` and `*.pfx`, which `projects/path-policy.ts:40-50` refuses.
    - `**/id_*` also blocks ordinary files such as `id_utils.ts`.
- **Do Read deny rules cover Grep and Glob?** Partly. The docs say Claude "makes a best-effort attempt to apply `Read` rules to all built-in tools that read files like Grep and Glob". Grep and Glob apply deny rules to the directory they search. Glob can still list a denied file's name, and a Grep over a parent folder is only filtered on a best-effort basis. Verify it with a live test that greps for a string that only appears in `.env`.
- **In `default` mode, does reading outside `cwd` ask?** Yes. Read-only tools need no approval only "within the working directory and additional directories" ([permissions table](https://code.claude.com/docs/en/permissions#permission-system)). Outside those, the SDK calls `canUseTool`, the adapter sends `session/request_permission`, and we reject it (`permissions.ts:11-24`). A hard stop that doesn't depend on our reply is `permissions.blockReadsOutsideWorkingDirectories: true`. It works in every mode, and the bundled CLI 2.1.280 supports it.
- **`additionalDirectories`.** Both routes work.
  - `session/new.additionalDirectories` is the spec field, and the adapter advertises it.
  - `_meta.claudeCode.options.additionalDirectories` and the legacy `_meta.additionalRoots` also work.
  - The adapter concatenates both (`CA/acp-agent.js:6307-6311`) and the SDK passes each as `--add-dir`. Flag-added directories also load a few `.claude/` config types ([permissions: Additional directories](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration)).
  - Prefer the spec field.
- **Settings sources.** The adapter defaults `settingSources` to user, project and local (`:6377`). A caller can override that through `_meta.claudeCode.options.settingSources`, because the options are spread after the default. The adapter's own `SettingsManager` still reads files to choose the _initial_ permission mode (`:6264-6268`). We then switch to `default` through `set_config_option`, before any prompt is sent.
- **Bypass.** `bypassPermissions` stays in the mode list unless `_meta.claudeCode.options.allowDangerouslySkipPermissions === false` (`:6266`) or settings disable it.
- **Sandbox.** Claude's `sandbox` setting only restricts Bash and its child processes ([permissions: sandboxing](https://code.claude.com/docs/en/permissions#how-permissions-interact-with-sandboxing)). It doesn't affect Read, Glob or Grep. It doesn't matter while Bash is off.

## Codex adapter (codex-acp 1.13.1)

| Question                      | Answer                                                                                                                                                                                                            | Source                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `promptCapabilities`          | `image: true`, `embeddedContext: true`                                                                                                                                                                            | `CX:37739-37742` (initialize at `:37707`)  |
| `sessionCapabilities`         | `resume`, `list`, `close`, `delete`, `fork`, `additionalDirectories`, `subagents`                                                                                                                                 | `CX:37717-37725`                           |
| `loadSession`                 | `true`                                                                                                                                                                                                            | `CX:37738`                                 |
| `mcpCapabilities`             | `http: true`, `sse: false`, `acp: false` (stdio supported)                                                                                                                                                        | `CX:37744-37748`                           |
| auth                          | `auth.logout`. Methods: ChatGPT login (hidden with `NO_BROWSER`), API key (`CODEX_API_KEY`/`OPENAI_API_KEY`), and gateway if the client opts in                                                                   | README "Authentication"; `CX:37755`        |
| Calls `fs/*` or `terminal/*`? | **No.** The SDK method names are only in the bundled schema (`CX:26291`, `:26783-26785`). Codex reads and writes through its own shell and `apply_patch`, inside its Seatbelt sandbox.                            | grep of `CX`                               |
| Modes (1.13.1)                | `read-only` = workspace-write + on-request + user approvals. `agent` (default) = workspace-write + on-request + **auto-review model approves**. `agent-full-access` = no sandbox + never ask.                     | `CX:32985-33030`                           |
| Per-turn policy               | Every `turn/start` sends `approvalPolicy` and `sandboxPolicy` from the mode, so `~/.codex/config.toml` and `CODEX_CONFIG` can't change them                                                                       | `CX:34124-34141`                           |
| `CODEX_CONFIG`                | A JSON object merged into the thread config. Then the adapter overwrites `projects` with `{[cwd, ...dirs]: {trust_level: "trusted"}}` and adds the extra directories to `sandbox_workspace_write.writable_roots`. | `CX:40564`, `:33969-33990`, `:34397-34410` |
| `INITIAL_AGENT_MODE`          | Starting mode id. An unknown id falls back to `agent` (auto-review).                                                                                                                                              | `CX:33064-33071`                           |

### Codex: reading a folder

- **`read-only` sandbox on macOS (Codex itself).** Seatbelt allows reads of the **whole disk**: the legacy `ReadOnly` policy has only `network_access`, and `has_full_disk_read_access()` is always true ([protocol.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)). It blocks writes and, by default, the network. Anything that needs more goes to an approval.
  - codex-acp 1.13.1 never sends it. Its `read-only` mode is `workspaceWrite`, so `cwd`, `/tmp` and `$TMPDIR` are writable, except `.git`, `.codex` and `.agents` ([approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)).
- **Limit reads to certain roots?** Not through codex-acp 1.13.1. Codex's newer permission profiles (`default_permissions`, `[permissions.<name>.filesystem]` with `read`, `write` or `deny`, plus `:workspace_roots` and `:minimal`) can limit reads ([permissions](https://learn.chatgpt.com/docs/permissions)). But:
  - The adapter sends a legacy `sandboxPolicy` on every turn.
  - Profiles "do not compose with the older sandbox settings".
  - Deny globs were reported as not blocking reads in 0.130 ([openai/codex#22179](https://github.com/openai/codex/issues/22179), open).
  - Treat this as unavailable.
- **`features.shell_tool`.** A stable flag, on by default: "Enable the default shell tool" ([features/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/features/src/lib.rs)). With it off, Codex has no command tool, and in practice no way to read files (it has no separate read tool).
  - It does **not** remove `apply_patch`. That tool has no feature gate (`apply_patch_freeform` is removed), so Codex can always edit inside its writable roots.
  - `unified_exec` (stable, on by default) is the PTY exec tool. `js_repl` is a removed flag, so setting it does nothing.
- **Approvals to ACP.** Three app-server requests become `session/request_permission`:
  - `item/commandExecution/requestApproval` (commands, including network escalation)
  - `item/fileChange/requestApproval` (patches outside the writable roots)
  - `item/permissions/requestApproval` (asks for extra filesystem or network access)

  Handled at `CX:31352-31420`, registered at `:34533-34560`. A cancelled outcome or an unknown option is sent to Codex as `cancel` or reject. With `on-request`, **commands and edits inside the sandbox run without asking**, and only escalations reach us. In `agent` mode the auto-reviewer answers first.

- **Extra roots.** `session/new.additionalDirectories` (or `_meta.additionalRoots`) must be absolute paths (`CX:34375-34396`). They are **added as writable roots** in both config and turn policy (`:34423-34431`), marked `trust_level = "trusted"`, and scanned for skills. The CLI flag `--add-dir` does the same thing, but the adapter doesn't expose it. In 1.13.1 an Ask run that passes extra folders makes them writable.
- **Deny secret files natively?** Not reliably. Permission-profile `deny` globs are the only native mechanism: they are overridden by the adapter's per-turn policy and reported broken (#22179). The `.codexignore`-style ideas are third-party. Assume Codex can `cat .env` anywhere on disk.

## Routing reads through us (both agents)

Neither adapter calls client fs, so `fs/read_text_file` can't be used to enforce anything. The supported route is MCP, which both adapters accept in `session/new.mcpServers`: stdio for both, and HTTP too.

- Run a small stdio MCP server, `spark-fs`, with `read_file`, `list_files` and `search`, backed by `projects/path-policy.ts` and the run's roots. Mark each tool `readOnlyHint: true`.
- Claude: `tools: []`, `allowedTools: ['mcp__spark-fs__read_file', 'mcp__spark-fs__list_files', 'mcp__spark-fs__search']`, `strictMcpConfig: true`. Reads then cover exactly our roots, with our secret list, and show up in our work log.
- Codex: `shell_tool: false` and `unified_exec: false`, plus the MCP server. `apply_patch` remains, so this still needs a real read-only sandbox (see below) to block edits.
- `HARNESS_PLAN.md:259` defers `mcpServers`. Pulling this forward is the only way to make "the agent reads through our path policy" true for real agents.

## Safest setup

### (a) Ask in one or more folders (read-only)

**Claude.** `session/new`:

```ts
{
  cwd: root0,
  additionalDirectories: [root1, …],     // spec field; adapter advertises it
  mcpServers: [],
  _meta: { claudeCode: { options: {
    tools: ['Read', 'Glob', 'Grep'],
    disallowedTools: SECRET_READ_RULES,   // align with path-policy (add .pgpass, .pypirc,
                                          // .git-credentials, credentials*, *.p12, *.pfx; allow .env.example)
    settingSources: [],                   // no project hooks/env/apiKeyHelper, no user additionalDirectories
    settings: { permissions: {
      deny: SECRET_READ_RULES,
      blockReadsOutsideWorkingDirectories: true,
      disableBypassPermissionsMode: 'disable',
    } },
    allowDangerouslySkipPermissions: false,
    strictMcpConfig: true,
  } } },
}
```

Then set the mode to `default` (as today) and keep declining every permission request.

- `settingSources: []` also drops `CLAUDE.md`. If we want it, add `'project'` back only once we trust the folder's hooks.
- Better still: `tools: []` plus the `spark-fs` MCP server described above.

**Codex, on 1.13.1.** There is no safe read-only configuration. Choose one:

1. Keep Codex chat-only for Ask: `shell_tool: false`, `cwd` set to the scratch folder, and no project root (today's chat setup).
2. Keep project access but run Codex with `cwd` set to the scratch folder and give it the `spark-fs` MCP server, with `shell_tool: false`. `apply_patch` can then only write to the scratch folder and `/tmp`.
3. Wrap the agent process in `sandbox-exec`. That reverses Decision 5.

**Codex, after upgrading to a release with PR #480.** Use `INITIAL_AGENT_MODE=read-only` and `conversationMode: 'read-only'`. This is now a `readOnly` sandbox: reads anywhere on disk, no writes, no network, on-request approvals that we decline. Use `CODEX_CONFIG={"features":{"shell_tool":true,"unified_exec":false},"web_search":"disabled"}` and pass extra roots as `additionalDirectories`. Under `readOnly` they don't become writable, but check that `addAdditionalDirectoriesToSandboxPolicy` still skips non-`workspaceWrite` policies. Secrets outside our control stay a known gap. Add `spark-fs` MCP if that gap isn't acceptable.

### (b) Do with approvals (M2)

**Claude.**

- `tools: ['Read','Glob','Grep','Edit','Write','Bash']`
- the same `settingSources`, `settings.permissions` (deny rules plus `blockReadsOutsideWorkingDirectories`) and `allowDangerouslySkipPermissions: false` as in Ask
- mode `default`: edits and non-read-only Bash ask, and each request becomes an approval card
- never `acceptEdits`, `auto` or `bypassPermissions`
- optionally `sandbox: { enabled: true, autoAllowBashIfSandboxed: false }` so Bash is also OS-confined while every command still asks
- `permissions.allow` rules for the project allowlist, passed in `settings`, not written to the repo

**Codex.**

- The mode is `read-only` on 1.13.1, or `workspace-write` after PR #480: workspace-write rooted at the project, `on-request`, `approvalsReviewer: user`.
- Never `agent`: its auto-reviewer approves for the user.
- Never `agent-full-access`.
- Keep `web_search: 'disabled'` and `unified_exec: false`. Point `TMPDIR` at the run folder.
- Be aware: under `on-request`, **commands and edits inside the project run without a permission request**. So HARNESS_PLAN's "commands that always ask" can't be done with codex-acp's modes. The adapter fixes `approvalPolicy` per turn, and the old `untrusted` policy is deprecated.
- If every command must ask, the choices are:
  - Codex execpolicy rules (`prefix_rule(..., decision="prompt")` in `~/.codex/rules`), which aren't verified through the adapter
  - an upstream request for a stricter mode
  - accepting sandboxed auto-run, and saying so on the card

### (c) Parallel Builders in worktrees (M7, September 26)

- Each parallel Builder's session gets the worktree (`<project>/.spark/worktrees/<runId>`) as `cwd` and as its only project root, so both adapters' own sandboxes and our path policy are scoped to the copy. A write to the main copy is outside the roots and is refused or asks like any outside path.
- Nothing about the adapter configuration changes: the same Do session settings, modes and approvals apply, and approval paths are relative to the worktree.
- A worktree's `.git` is a file, not a folder. The "no edits inside `.git`" rule still holds; the harness, not the agent, commits the copy.
- Claude reads project settings from the copy's checkout, which matches the main copy at the group base, so the `settingSources` exposure is the same as in the main copy.
- Ignored files (`node_modules`, `.env`, build output) are not in the copy, so commands that need them fail there. Agents should not be told to install dependencies into a copy.

## What we should change (ranked by risk)

1. **High: Codex Ask writes to the project.**
   - `agents.ts:76-78` plus `acp-provider.ts:85-92`: a project run gives Codex `cwd` = the project and `shell_tool: true` in a workspace-write sandbox. Disable Codex project runs, or use option 1 or 2 above, until we can pin a codex-acp release with a real `readOnly` mode.
   - Fix `ACP_AGENTS.md:49-52` and `HARNESS_PLAN.md:51`.
2. **High: Claude runs project hooks, `env` and `apiKeyHelper` from a linked folder.** Add `settingSources: []` (or `['user']` at most) to `projectSessionMeta` and `conversationSessionMeta` (`agents.ts:61-70`).
3. **High: our fs policy is not in the real read path.** `client-info.ts:9-16` advertises `readTextFile` and `fs-handlers.ts` enforces the policy, but neither real adapter calls it. The docs should stop implying they do. Add `spark-fs` MCP to get enforcement.
4. **Medium: Codex extra roots become writable and trusted.** Don't pass `additionalDirectories` to Codex 1.13.1 in Ask. `trust_level = "trusted"` also lets a project's `.codex/config.toml` layer apply (for example `mcp_servers`). We can't override it, because the adapter replaces `projects` after merging `CODEX_CONFIG` (`CX:33980-33986`). Verify with a test folder that has a `.codex/config.toml`.
5. **Medium: Claude bypass mode is still offered.** Add `allowDangerouslySkipPermissions: false`. Our mode lock (`mapper.unsafeModeChange`) only reacts after the fact.
6. **Medium: Claude reads outside the folder depend on us declining.** Add `settings.permissions.blockReadsOutsideWorkingDirectories: true`, so a bug in `permissions.ts`, or M2 approvals, can't open reads outside the roots.
7. **Medium: `SECRET_READ_RULES` doesn't match `path-policy.ts`.** Add the missing names and extensions, allow `.env.example`, and narrow `id_*` to `id_rsa*`, `id_ed25519*`, `id_ecdsa*` and `id_dsa*`. Also pass the rules in `settings.permissions.deny`. That's the documented path, where `disallowedTools` is the CLI flag form.
8. **Medium: mode names will change on upgrade.** `conversationMode: 'read-only'` in `agents.ts:76` means workspace-write today and readOnly after PR #480. Pin codex-acp exactly, and add a unit test that fails when `read-only`'s `sandboxPolicy.type` changes. The probe can read `_meta.kind` and the descriptions.
9. **Low: `INITIAL_AGENT_MODE` falls back silently.** A typo gives `agent`, which auto-approves (`CX:33067`). We also set the mode by config option and stop if that fails (`apply-settings.ts:77-88`), which covers this.
10. **Low: `js_repl: false` does nothing.** It's a removed Codex flag, so drop it or leave it with a comment. `web_search: 'disabled'` is valid.
11. **Low: we don't send `additionalDirectories` yet.** `acp-provider.ts:212-218` sends only `cwd`. For multi-folder Ask on Claude, use the spec field rather than `_meta`. Both adapters advertise it.
12. **Docs:** `HARNESS_PLAN.md:164` says the agents' shell tools "go through `request_permission`". For Codex, sandboxed commands don't. `HARNESS_PLAN.md:288` counts on "Codex workspace-write" as the Ask sandbox.

## Verify live (not run here)

- Claude, project Ask: `Grep` for a token that exists only in `.env`; `Glob **/.env`; a `Read` of `../outside.txt` (expect a declined permission); a symlink inside the root that points outside.
- Claude, with `settingSources: []`: a `.claude/settings.json` hook in the test folder must not run.
- Codex 1.13.1, project Ask: ask it to create `x.txt` in the root. We expect it to succeed with no permission request, which confirms finding 1.
- Codex with a project `.codex/config.toml` that defines an MCP server: check whether it starts.

## Verified live for Do (September 26)

- Codex 1.13.1 with our patch, asked to run `ls` and create a file in a temp git repo: in `agent` mode both ran with no `session/request_permission`; in `read-only` mode `ls` ran unasked and only the write became a permission request (`edit`, offering `allow_once`, `allow_always`, `reject_once`). This confirms that commands can't be made to ask, so Codex Do is unavailable (HARNESS_PLAN, M2 status).
- Claude 0.81.2 with `settings.permissions.ask: ['Bash', 'Edit', 'Write']` in `default` mode asked for an edit, for `ls` and for `git push`, each as one `session/request_permission`.
