export interface GuideSection {
  id: string;
  title: string;
  keywords: string[];
  text: string;
}

export const guideSections: GuideSection[] = [
  {
    id: 'overview',
    title: 'What Spark Outpost is',
    keywords: ['spark', 'outpost', 'overview', 'what', 'product'],
    text: `Spark Outpost is a local-first workspace where you give a goal to a team of AI agents, follow meaningful progress, make decisions when needed, and get results with verification evidence. The application owns the workflow; providers (Claude, Codex, Z.ai) supply intelligence and execution.

A conversation is a durable record; a provider session is one replaceable execution resource inside it. Every chat enters the same harness for policy and persistence, but not every message needs a planner, a team of specialists or a reviewer — simple questions take a direct path.`,
  },
  {
    id: 'providers',
    title: 'Connecting providers: Claude, Codex, Z.ai',
    keywords: ['provider', 'connect', 'claude', 'codex', 'zai', 'z.ai', 'glm', 'login', 'api key'],
    text: `Spark runs coding agents through the Agent Client Protocol (ACP): Claude via claude-agent-acp, Codex via a patched codex-acp, and Z.ai (GLM) by running the same Claude Code agent against Z.ai's Anthropic-compatible endpoint with an isolated config directory.

Connect Claude and Codex with your existing CLI login (\`claude\` / \`codex\`), which Spark detects; API-key connections for them are not wired up yet. Z.ai connects with an API key only, verified with one small test call and stored in the OS keychain. Z.ai never touches your Claude.ai login: it runs in a clean environment with no ANTHROPIC_*, CLAUDE_*, AWS_* or OPENAI_* variables inherited, and \`--hide-claude-auth\` refuses any session that would bill a claude.ai subscription.`,
  },
  {
    id: 'jev',
    title: "Jev, Spark's advisor",
    keywords: ['jev', 'advisor', 'typesafe', 'system one', 'judgment'],
    text: `Jev (TypeSafe's "System One") is an optional decision service, not a chat or coding model — it doesn't generate text, stream, call tools or edit files. It answers typed questions (Choice, Score, Noul) with calibrated probabilities over a short state you send it.

Spark uses Jev for a handful of concrete judgments per Do turn: whether a message is a question or a change, whether it's vague enough to need clarifying, whether it looks destructive, whether a Critic review is warranted, and a verifier check on the finished diff. Code always owns the policy and the act line for each question; Jev's answer only decides at high confidence, and low-confidence answers fall back to plain rules. With Spark off, Jev is never called. Answers below the confidence band never grant anything by themselves.`,
  },
  {
    id: 'ask-vs-do',
    title: 'Ask vs Do, and agent modes',
    keywords: [
      'ask',
      'do',
      'mode',
      'agent mode',
      'manual',
      'plan',
      'auto',
      'bypass',
      'read-only',
      'full access',
    ],
    text: `A chat without a linked project just answers from the conversation — no tools. Link one or more project folders and a chat becomes Ask (the agent may read inside the folders but change nothing) or Do (the agent may also edit files and run commands), depending on the agent mode you pick.

Agent permissions come from the provider itself, shown with its own names: Claude offers Manual (default), Accept edits, Plan, Auto and Bypass permissions; Codex offers Read-only (Ask for approval), Ask every time, Approve for me and Full access. Read-only modes are treated as Ask; the rest are Do. Next to the agent mode sits the harness autonomy (Review each step, Automatic, Full auto → PR), which controls how much the harness asks you versus decides on its own — the two are independent choices.`,
  },
  {
    id: 'autonomy-levels',
    title: 'Autonomy levels: Review each step, Automatic, Full auto → PR',
    keywords: [
      'autonomy',
      'level',
      'review each step',
      'automatic',
      'full auto',
      'balanced',
      'hands-off',
    ],
    text: `Alongside the agent's own mode, Spark has a harness autonomy with three levels:

Review each step: you decide whether to keep the changes, see the Critic's findings before any fix, and get a card before risky work starts.

Automatic (default): runs commands in this chat's worktree without asking; still asks for risky ones. Changes are kept when the checks pass, the Critic's findings are fixed in a loop, and risky work runs in a worktree copy. Revert is always there.

Full auto → PR: Automatic, in a worktree copy, then Ship commits, pushes the task branch and opens a draft PR. Nothing ever merges.

The safety floor below holds in every mode and at every level.`,
  },
  {
    id: 'safety-floor',
    title: 'Approvals and the safety floor',
    keywords: ['approval', 'safety', 'floor', 'secret', 'publish', 'push', 'permission', 'gate'],
    text: `Every agent action that isn't pre-approved goes through the backend's approval gate, which enforces a safety floor no mode or level can loosen: secret files (.env, SSH and other keys, credentials files) always ask or are refused for reads and writes; Builders never publish — the gate refuses git push, remote changes, and gh/hub/glab from a Builder at every level, because only Spark's own Ship step pushes and opens PRs; no writes happen outside the folders you've linked; and every command and approval decision is written to a hash-chained audit log.

Budgets cap each task: active time, tool calls, and a cost cap you can set under Settings → Spark. A spent budget stops the run and asks before continuing. An "Always allow" choice becomes a stored, scoped rule, never a blanket bypass of the floor.`,
  },
  {
    id: 'worktrees',
    title: 'Worktrees: chat worktree vs your checkout',
    keywords: ['worktree', 'checkout', 'branch', 'copy', 'chat worktree'],
    text: `By default, a chat's Do work happens in its own git worktree on its own branch (spark/<title>-<id>), reused across every turn of that chat — your actual checkout is left alone unless you choose to work there.

When work does happen in your checkout, Spark still makes a private worktree copy for specific cases: every Full auto → PR task (so it can ship from its own branch), a provider mode that skips the approval gate (Codex Approve for me or Full access), a second task running in the same repo at once, destructive work, and risky work at Automatic. A worktree copy merges back into your checkout after each Builder turn; if your own files changed in the meantime, you get a card to keep your version, keep the agent's, or stop. Copies are cleaned up when the turn finishes, and the worker sweeps orphaned copies after a crash.`,
  },
  {
    id: 'coordinator',
    title: 'The coordinator and parallel Builders',
    keywords: ['coordinator', 'builder', 'parallel', 'pieces', 'integrator', 'shared tree'],
    text: `Small and medium work runs as today's lean path: one task-scoped Builder session, checks with fix turns, and a Critic by rule — no coordinator overhead. For a story too big for one Builder, or one you ask to split up, the coordinator plans it, splits it into Builder-sized pieces with declared file ownership, and places each piece: in order (one Builder at a time), in a shared tree (several Builders in the same checkout, each restricted to its own owned files by the approval gate), or in separate worktree copies (for long, destructive, or otherwise isolation-worthy pieces).

Builders never run git stash, checkout, reset, commit, merge or rebase — only the coordinator's integrator, a single Builder session, merges pieces, resolves conflicts, renumbers colliding migrations, and runs the full project checks once on the integrated result before the Critic reviews it.`,
  },
  {
    id: 'critic-checks',
    title: 'Critic and checks',
    keywords: ['critic', 'check', 'review', 'verify', 'checks failed'],
    text: `After a Builder's project checks pass, a "verified cascade" asks Jev whether the change plausibly meets the request; an unsupported answer reruns once with a stronger model, and a declined one asks you.

A Critic review — from a different provider when one is connected — runs for destructive work, a migration, an explicit review request, a large diff (400+ changed lines or 10+ files), a build from an agreed plan, or a feature spanning several files or areas; never for a one-liner. Concerns with concrete correctness findings trigger a resumed fix turn, checks run again, and the Critic reviews again, up to three fix rounds. Every check round is recorded as an artifact on the task with each command's outcome, exit code and output.`,
  },
  {
    id: 'ship',
    title: 'Ship: commit, push, draft PR',
    keywords: ['ship', 'commit', 'push', 'draft pr', 'pull request', 'merge'],
    text: `Ship turns a chat's changes into git history: commit only, push, or open a draft pull request. Ship never merges anything — that stays your decision. It refuses to push a branch that carries Spark's own internal snapshot commits, and only pushes its own single-level spark/<slug>-<id> branches, never a raw worktree branch.

In a chat worktree, the keep card offers "Bring changes into <your branch>", "Open draft PR" (Ship), or leaving the work on the chat's own branch. At Full auto → PR, Ship runs automatically after an auto-decided keep: it opens a draft PR when GitHub is connected, otherwise pushes, or commits only when there's no remote — and the result always includes the link.`,
  },
  {
    id: 'tickets',
    title: 'Tickets inbox and connectors',
    keywords: ['ticket', 'jira', 'linear', 'github', 'inbox', 'connector', 'attention'],
    text: `Tickets connects Jira, Linear and GitHub and pulls your tickets into one inbox, sorted into sections: needs attention first (overdue, stale, blocked, urgent-not-started), then working, PR ready, in review, and up next. Each ticket carries its status, priority, why it's flagged, due date, and any linked Spark chat or pull request.

The spark_tickets tool fetches the same live data the Tickets page shows, and can sort by inbox order or by priority. If no source is connected yet, connect Jira or Linear from Settings → Tickets.`,
  },
  {
    id: 'attention-brief',
    title: 'Attention rules and the morning brief',
    keywords: ['attention', 'morning brief', 'digest', 'flagged'],
    text: `The morning brief is a written digest summarizing recent chat activity and the tickets currently flagged for attention, refreshed on a schedule rather than on every visit. It's read-only from spark_brief — asking the tool doesn't generate a new brief, it returns the latest one along with whether newer activity exists since it was written and when it can next be refreshed.

Attention rules decide which tickets get surfaced as needing you: things like overdue due dates, staleness, being blocked, or being urgent and not yet started.`,
  },
  {
    id: 'map',
    title: 'Project Map',
    keywords: ['map', 'project map', 'areas', 'repo map'],
    text: `The Project Map is a background, read-only model of each linked repository: every indexed file, its resolved imports, the areas files group into (by package or folder), how important each file is, and links between repositories (a front end calling a back end, shared packages, shared env keys).

It builds in the worker process at low priority, pausing whenever an agent run is active, and updates incrementally as commits land. Areas get a category (Core, Shared, Feature) and a kind (ui, api, data, domain, auth, integration, infra, tooling, config, tests, docs), labelled by rule or, when Jev is connected, by one call per area with evidence drawn only from non-secret files.`,
  },
  {
    id: 'mcp-servers',
    title: 'MCP servers: user-level and repo .mcp.json',
    keywords: ['mcp', 'mcp server', 'mcp.json', 'trust'],
    text: `Agent sessions can use MCP servers from two sources: user-level servers you add by hand in Settings → MCP servers (scoped to all chats, a project, or a single chat), and a linked repo's own .mcp.json. Every MCP tool call still asks for approval unless the agent's mode lets everything through.

A repo's .mcp.json, hooks, and allow rules only load after you trust that folder (a one-time "Trust this folder?" decision); trust is fingerprinted, so a changed hooks/MCP/allow-rules set asks again. Env and header secret values for MCP servers live in the OS keychain, never in the database, and are redacted in the audit log.`,
  },
  {
    id: 'repo-agent-config',
    title: "A repo's own agent config: instructions, skills, hooks",
    keywords: ['agents.md', 'claude.md', 'instructions', 'skills', 'hooks', 'trust', 'repo config'],
    text: `Spark reads a linked repo's own agent setup and passes it on carefully. Instructions (CLAUDE.md, AGENTS.md, .cursorrules and similar) and skills/commands/subagents are on by default: Claude gets instructions appended to its system prompt and skills as a sanitized local plugin; Codex reads AGENTS.md itself and gets other instruction files as developer instructions.

Hooks and a repo's permissions.allow rules are off until you trust the folder (or approve that exact set); some allow rules — like bare Bash or Edit, or anything touching git push/remote — are never applied even when trusted. MCP servers and "keys and traffic" env settings (like a custom ANTHROPIC_BASE_URL) are off per item until reviewed. Every switch and every trust decision is recorded in the audit log.`,
  },
  {
    id: 'spark-own-tools',
    title: "Spark's own tools (the spark MCP server)",
    keywords: ['spark_', 'tools', 'mcp server', 'spark tools', 'self-service'],
    text: `Every agent session Spark launches (chat, Ask, Do, Builders — Claude, Z.ai and Codex alike) gets a built-in, read-only MCP server named "spark", so agents can answer questions about Spark itself without guessing.

Its tools include spark_providers, spark_connectors, spark_settings, spark_projects, spark_map, spark_chats, spark_chat, spark_audit, spark_tickets, spark_analytics, spark_activity, spark_brief, and spark_guide (this tool). All are read-only and never change anything, except spark_tickets, which refreshes the same ticket cache the Tickets page refreshes. Calls need no approval card — the server is pre-trusted — and results are compact JSON, redacted and size-limited the same way as everywhere else in Spark.`,
  },
  {
    id: 'analytics',
    title: 'Analytics and spend',
    keywords: ['analytics', 'spend', 'cost', 'health', 'harness report'],
    text: `Analytics shows Overview, Spend and Harness tabs over the last 7, 30 or 90 days, all computed locally from this workspace's own history — nothing is sent anywhere except what you ask "Ask about this view" to explain.

Overview covers turns, runs, cost, outcomes (good/bad/mixed), keep and revert rates, checks and a 0–100 health score. Spend breaks down reported and estimated cost by project, provider and model, cost per task and per good outcome, and Jev's own spend. Harness shows routing paths, how often Jev and the deterministic rules agree, Critic activity, checks, retry loops, and approval wait times. The spark_analytics tool returns the same three reports for a chosen window.`,
  },
  {
    id: 'audit-log',
    title: 'The audit log',
    keywords: ['audit', 'audit log', 'protocol log', 'hash chain', 'verify'],
    text: `Every agent run's full protocol traffic — every JSON-RPC message to and from the agent, redacted — is recorded to a per-run, hash-chained audit log, along with harness entries like check results and Ship attempts. Secrets (API keys, tokens, passwords, secret-file contents) are redacted before anything is stored.

The chain lets Spark detect tampering: verifying it walks every row and reports the first broken one. Logs are retained 90 days by default and can be exported per conversation as JSONL or CSV. spark_audit reads a run's log for troubleshooting a specific run.`,
  },
  {
    id: 'desktop-app',
    title: 'The desktop app (Electron)',
    keywords: ['desktop', 'electron', 'app', 'packaging'],
    text: `Spark Outpost's desktop shell is Electron, kept deliberately thin: the same React web app runs in the renderer, while the API server and workflow worker run in their own processes (never in Electron's main process), and PostgreSQL is bundled and started as a child process rather than requiring Docker or Homebrew.

Local API calls require a per-launch token so nothing else on your machine can reach them. A separate "Dev" channel (its own app ID, data folder, database, and branch prefix) keeps development builds from ever touching your everyday installed app's data. Packaging (code signing, notarization, auto-update) is the step still ahead of general release.`,
  },
];
