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
    text: `Spark Outpost is a local-first workspace where you give a goal to an AI agent, follow meaningful progress, make decisions when needed, and get results. One chat is one agent session (Claude, Codex, Z.ai or a custom endpoint): the user's message goes to the agent as typed, and the agent decides whether to plan, use its own sub-agents, or split the work into sub-chats in an outpost, which it starts itself (asking first when its mode asks) or proposes for the user to start.

Spark moderates around the agent: the approval gate and safety floor, the audit, a worktree and branch per chat, the publish step, pull request follow-up and its own tools. Spark splits no turn into roles, runs no checks of its own and picks no model. A conversation is a durable record; a provider session is one replaceable execution resource inside it.`,
  },
  {
    id: 'providers',
    title: 'Connecting providers: Claude, Codex, Z.ai, custom endpoint',
    keywords: ['provider', 'connect', 'claude', 'codex', 'zai', 'z.ai', 'glm', 'login', 'api key'],
    text: `Spark runs coding agents through the Agent Client Protocol (ACP): Claude via claude-agent-acp, Codex via a patched codex-acp, and Z.ai (GLM) by running the same Claude Code agent against Z.ai's Anthropic-compatible endpoint with an isolated config directory.

Connect Claude and Codex with your existing CLI login (\`claude\` / \`codex\`), which Spark detects; API-key connections for them are not wired up yet. Z.ai connects with an API key only, verified with one small test call and stored in the OS keychain. Z.ai never touches your Claude.ai login: it runs in a clean environment with no ANTHROPIC_*, CLAUDE_*, AWS_* or OPENAI_* variables inherited, and \`--hide-claude-auth\` refuses any session that would bill a claude.ai subscription.`,
  },
  {
    id: 'custom-endpoint',
    title: 'Custom endpoint: local models and gateways',
    keywords: ['custom endpoint', 'ollama', 'lm studio', 'llama.cpp', 'litellm', 'local model'],
    text: `A custom endpoint runs the same Claude Code agent, in the same clean environment with its own config directory, against any server that speaks the Anthropic Messages API (for example Ollama, LM Studio, a llama.cpp server or LiteLLM). The user enters the server address (https, or http only for localhost), the model name, an optional fast model and an optional API key in Settings → AI providers; the settings and key are stored together in the OS keychain and checked with one small test request. There is no OpenAI-format adapter, and how well tools work depends on the model.`,
  },
  {
    id: 'jev',
    title: "Jev, Spark's advisor",
    keywords: ['jev', 'advisor', 'typesafe', 'system one', 'judgment'],
    text: `Jev (TypeSafe's "System One") is an optional decision service, not a chat or coding model — it doesn't generate text, stream, call tools or edit files. It answers typed questions (Choice, Score, Noul) with calibrated probabilities over a short state you send it.

Jev is never called inside a turn. Spark uses it outside turns: labelling the Map's areas, sorting pull request feedback, and picking what a chat's short update on Spark Island says. Code always owns the policy and the act line for each question; Jev's answer only decides at high confidence, and low-confidence answers fall back to plain rules, as does everything when Jev is not connected. Answers never grant anything by themselves. What is sent is redacted first and never used for training.`,
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
      'run a command',
    ],
    text: `A chat without a linked project answers from the conversation; it can't touch files or run commands, but agents can still use Spark's own spark_* tools. Link one or more project folders and a chat becomes Ask or Do, depending on the agent mode you pick.

Ask: the agent reads the folders and runs read-only commands directly, loops and $(…) included. Other commands run without asking at Automatic or in an Auto or Bypass mode, and show a "Run a command?" card otherwise. Changing files, installing or pushing is refused — for Do work, ask for the change in a message, or leave a read-only mode. Do: the agent may also edit files and run commands.

Agent modes come from the provider, with its own names: Claude offers Manual, Accept edits, Plan, Auto (default) and Bypass permissions; Codex offers Read-only, Ask every time, Approve for me and Full access. Read-only modes are Ask; the rest are Do. Spark autonomy is a separate choice.`,
  },
  {
    id: 'autonomy-levels',
    title: 'Autonomy levels: Automatic, Full auto → PR',
    keywords: [
      'autonomy',
      'level',
      'automatic',
      'full auto',
      'hands-off',
      'how much spark does alone',
    ],
    text: `Alongside the agent's own mode, Spark has two autonomy levels. Default for new chats: Settings → Spark → How much Spark does alone; each chat can pick its own. To review each step, pick an agent mode that asks (Manual, Plan).

Automatic: approval cards follow the agent's mode; Ask turns run commands without asking. Changes are kept ("Changes kept"); Revert is always there. Spark has no plan card and saves no plan of its own: to approve a plan first, use /plan or Plan mode; the approved plan shows as one line ("Plan saved"). In a Plan-mode chat every message plans first.

Full auto → PR (default): the same; then, when the turn changed files, Spark sends the agent one publish prompt and the agent pushes the chat's branch and opens a PR (a draft only when you ask or Open pull requests as says so). Nothing merges. A failed or stopped publish keeps the change ("Not published: …"). The level never makes a Spark action skip its card.

Spark's rules (none by default) apply at all levels.`,
  },
  {
    id: 'read-then-send',
    title: 'Read, then send',
    keywords: ['exfiltration', 'curl', 'sensitive', 'network', 'egress', 'secret', 'send data'],
    text: `Once a turn has seen sensitive data (a secret file read directly or by a script, secret values in tool output such as env or config dumps, a web page, or private work data from spark_tickets, spark_slack, spark_pr and similar tools), a send off this computer gets a note, never a card of its own: when the mode would run it, it runs with an audit entry and a non-blocking flag ("sent data … after reading …"); when the mode asks, its card carries the note. The note names what was read (never values) and where the data went, and ends with the turn. Sends include curl, wget, ssh, git push, gh, cloud CLIs, publishing, user MCP tools and web fetches; localhost and the chat's own repo and PR don't count. With the recommended rules, a push or upload holding a secret file's value asks with hold to confirm.`,
  },
  {
    id: 'safety-floor',
    title: 'Approvals and the safety floor',
    keywords: [
      'approval',
      'safety',
      'floor',
      'secret',
      'publish',
      'push',
      'force push',
      'hold',
      'permission',
      'gate',
      'budget',
      'spend cap',
    ],
    text: `The approval gate follows the agent's mode: a card only when the mode or the agent asks. Spark's rules (settings.json in Spark's data folder; managed-settings.json) add a floor. With no file, the default, every rule follows the mode: Auto or Bypass may force push, push any branch, edit secret files, hooks and instruction files, write outside the project and publish unasked. With the recommended rules: changing a secret file asks or is refused (.sparkignore reads ask); agents push only the chat's own spark/ or adopted PR branch and its PR, only when asked, at Full auto → PR or in Auto/Bypass; writes outside the linked folders ask (temp folders fine); a --force-with-lease to a named, non-default branch asks with hold to confirm, other force pushes are refused.

Recommended rules also refuse merges, approvals, --admin, gh api writes and gh auth, including credential commands. Always refused: Spark's rules files and ports, --no-verify, Spark's browser data. All audited; no run budgets.`,
  },
  {
    id: 'worktrees',
    title: 'Where Spark works: chat worktree or my files',
    keywords: [
      'worktree',
      'checkout',
      'branch',
      'copy',
      'chat worktree',
      'where spark works',
      'my files',
      'in place',
      'bring changes',
    ],
    text: `Each project has a "Where Spark works" setting (Settings → Projects, also remembered from a chat's place picker): Each chat in its own worktree (recommended, the default) or In my files.

In its own worktree, a chat's first turn in a mode that can change files creates a git worktree under .spark/worktrees on a new spark/<title>-<id> branch, reused by every later turn, so chats work side by side and your folder stays as it is. A turn in a read-only mode doesn't create one; a Plan-mode chat does, even for a question. The kept record offers Bring changes into your branch; Ship is in the Work panel. The worktree is released on archive, delete (unpushed work stays on the branch), merge and Reset.

In my files, new chats edit the folder directly. Such a chat has no branch of its own: at Full auto → PR the change is kept, nothing is pushed and the reply says so in one line.`,
  },
  {
    id: 'ship',
    title: 'Ship: commit, push, open a PR',
    keywords: ['ship', 'commit', 'push', 'draft pr', 'pull request', 'merge', 'ready for review'],
    text: `Ship turns a chat's changes into git history: commit only, push, or open a pull request. Settings → Spark → Open pull requests as picks Ready for review (default) or Draft; a pull request is a draft only when that setting says so or you ask for one. Nothing merges. It never pushes a branch carrying Spark's internal snapshot commits, only its own spark/<slug>-<id> branches or an adopted PR branch.

A turn that changed files ends in a "Changes kept" record (files, lines, branch, PR) that needs no answer; expanded, it offers "Bring changes into <your branch>". Ship is in the Work panel's Changes tab. At Full auto → PR when the turn changed files, or when you ask for a PR, Spark sends the agent one publish prompt after its reply: spark_push (with your shell logins, so hooks pass), then gh pr create or spark_pull_request. Spark runs no checks first; hooks and CI do. Spark checks GitHub and gives the link, or says no PR was opened. A push with no reason is refused, not asked about.`,
  },
  {
    id: 'pr-follow-up',
    title: 'PR follow-up: Spark handles checks and review feedback',
    keywords: ['follow up', 'review comments', 'failing checks', 'reply', 'copilot', 'coderabbit'],
    text: `After Spark opens a PR from a chat it watches it until merged or closed: failing checks, review comments, reviews and PR comments, bots included. Jev triages each item (rules without Jev): fix, question, needs you, nit, already addressed, information. Spark acts only on failing checks and comments from people with write access; others are shown, never acted on, and disagreements go to you. One round in the chat: the agent fixes what is right, pushes back with a reason, and pushes the fix at every level; Spark replies ("Fixed in <sha>: …"). Ask before pushing and replying restores the confirm card. Never force-pushes, merges, approves, resolves threads or dismisses reviews; 3 rounds per PR. Tools: spark_pr_follow_up, spark_pr_follow_up_round.`,
  },
  {
    id: 'tickets',
    title: 'Tickets inbox, links to chats and PRs',
    keywords: ['ticket', 'jira', 'linear', 'inbox', 'attention', 'link', 'unlink', 'priority'],
    text: `Tickets groups your Jira and Linear tickets by flow: Needs you, In progress with Spark, Started, Up next, In review / PR open, Done recently; side views filter. Rows show a status badge, Spark progress, priority, assignee, chat and PR links; the detail adds reporter, created date and pull requests. Failing PR checks are a badge in In review, never Needs you. Search covers every ticket.

A turn that changes files and names exactly one ticket in your own text links the chat to it. Linked chats show a "KEY · title" chip (Unlink, Undo), and Ship puts the key in the PR title. Mentions never move a ticket's status.

spark_tickets: live data; sort=priority for most urgent, action=read for one in full, action=search for any ticket.`,
  },
  {
    id: 'attention-brief',
    title: 'Attention rules and the morning brief',
    keywords: ['attention', 'morning brief', 'digest', 'flagged', 'idle', 'overdue', 'stale'],
    text: `A ticket needs attention when: a linked chat is asking you something or stopped with an error; a change Spark tried to sync failed; it is blocked (status or label); it is Urgent or High and still not started some days after it was assigned to you (idle days); it is due soon or overdue; its PR has changes requested or is approved and waiting to merge; or it has sat in review too long. The day thresholds are settings; an urgent ticket assigned today is not flagged yet.

The morning brief (Settings → Spark → Morning brief, with a time) is written after that time each morning on Home, summarizing what changed since the last one; the app must be running. spark_brief returns the latest brief and the currently flagged tickets without writing a new one.`,
  },
  {
    id: 'map',
    title: 'Project Map',
    keywords: ['map', 'project map', 'areas', 'repo map', 'core impact', 'unmatched'],
    text: `The Map page draws each linked repository as a sky of files grouped into areas, with links between areas and between repositories (front end to back end, shared packages, env keys). Filter areas by category (Core, Shared, Feature), files by kind, and links between projects; open a file for Jev's label, a preview, what depends on it, its imports and its history. With 2+ projects it lists unmatched API: routes nothing calls and calls that reach no route.

The Map builds in the worker at low priority, pauses while an agent runs, and updates as commits land. Areas are labelled by rule or, with Jev, by one call per area using only non-secret files. Changes that touch Core areas are highlighted as Core impact in the Changes pane and the PR description. spark_map returns a project's areas. spark_find ranks files for a request.`,
  },
  {
    id: 'mcp-servers',
    title: 'MCP servers: user-level and repo .mcp.json',
    keywords: ['mcp', 'mcp server', 'mcp.json', 'trust'],
    text: `Agent sessions can use MCP servers from two sources: servers you add in Settings → MCP servers (for all chats, a project or one chat), and a linked repo's .mcp.json. Every MCP tool call still asks for approval unless the agent's mode lets everything through. Agents list them with spark_mcp_servers and propose changes with the spark_*_mcp_server tools, by name only; you fill values in Settings.

A repo's .mcp.json, hooks, and allow rules only load after you trust that folder (a one-time "Trust this folder?" decision); trust is fingerprinted, so a changed hooks/MCP/allow-rules set asks again. Env and header secret values live in the OS keychain, never in the database, and are redacted in the audit log.`,
  },
  {
    id: 'repo-agent-config',
    title: "A repo's own agent config: instructions, skills, hooks",
    keywords: ['agents.md', 'claude.md', 'instructions', 'skills', 'hooks', 'trust', 'repo config'],
    text: `Spark reads a linked repo's agent setup and passes it on carefully. Instructions (CLAUDE.md, AGENTS.md, .cursorrules and similar) and skills/commands/subagents are on by default: Claude gets instructions appended to its system prompt and skills as a sanitized local plugin; Codex reads AGENTS.md itself and gets other instruction files as developer instructions.

Hooks and a repo's permissions.allow rules are off until you trust the folder (or approve that exact set); some allow rules — like bare Bash or Edit, or anything touching git push/remote — are never applied even when trusted. MCP servers and "keys and traffic" env settings (like a custom ANTHROPIC_BASE_URL) are off per item until reviewed. Every switch and trust decision is recorded in the audit log.`,
  },
  {
    id: 'spark-own-tools',
    title: "Spark's own tools (the spark MCP server)",
    keywords: ['spark_', 'tools', 'mcp server', 'spark tools', 'self-service', 'action card'],
    text: `Each agent session gets the "spark" MCP server with its chat's tools: ticket, Slack, PR tools need their connector; PR tools, spark_map and spark_find need a linked project. Ask Spark gets the same tools behind the same switches (any project for PR tools, spark_map and spark_find), except spark_push, spark_pull_request, spark_pr_follow_up, spark_pr_follow_up_round, spark_terminal_run, spark_outpost_ask, spark_outpost_start, spark_browser_sign_in, spark_rules_edit and spark_plugins_edit; its tools that ask follow When Ask Spark acts. A missing tool's note names its setting.

Read tools need no card (section spark-tools).

Action tools: ticket create, comment, move, assign; spark_pr_follow_up_round, spark_create_spark, spark_update_spark, spark_*_mcp_server, spark_calendar_edit, spark_jira_edit, spark_confluence_edit, spark_servicenow_edit. In Auto, Bypass or Full auto → PR they run at once; else a card; spark_rules_edit, spark_plugins_edit: always. Audited; agents open PRs themselves.`,
  },
  {
    id: 'spark-tools',
    title: 'Which Spark tool answers which question',
    keywords: ['which tool', 'spark_', 'tools', 'ask spark', 'question', 'answer', 'index'],
    text: `Attention: spark_attention. Run: spark_run. Task: spark_task. Chats: spark_chats, spark_chat. Old turns: spark_chat_history. Steps: spark_audit. Recent: spark_activity, spark_brief.
Spend: spark_spend, spark_analytics. Models: spark_models. Combine reads: spark_execute.
Agents: spark_providers. Connectors: spark_connectors. Slack: spark_slack. MCP servers: spark_mcp_servers. Settings: spark_settings. Projects: spark_projects. Areas, code: spark_map, spark_find. Terminals: spark_terminals. Tickets: spark_tickets. PRs: spark_pull_requests, spark_pr, spark_pr_follow_up. Sparks: spark_sparks. Guide: spark_guide, spark_docs. Browser: spark_browser_tabs, spark_browser_open, spark_browser_read, spark_browser_screenshot, spark_browser_logs, spark_browser_preview, spark_browser_signins. Mac: spark_mac_apps, spark_mac_read. Calendar: spark_calendar. Atlassian: spark_jira, spark_confluence. ServiceNow: spark_servicenow. Outposts: spark_outpost, spark_outpost_note, spark_outpost_draft.`,
  },
  {
    id: 'compaction',
    title: 'When a chat gets full: compaction',
    keywords: ['compact', 'compaction', 'context', 'full', 'ring', 'summary', 'tokens'],
    text: `The ring warns at 60%; Spark compacts at 80% between turns (both in Settings → Chats & autonomy, spark_settings). Spark uses the agent's /compact or a Spark summary; with automatic compaction off it asks: Compact now, a fresh chat with a summary, or Keep going. A divider shows it. spark_chat_history reads earlier turns.`,
  },
  {
    id: 'settings-spark',
    title: 'Settings → Spark',
    keywords: [
      'settings',
      'personality',
      'name',
      'companion',
      'spark island',
      'scout',
      'switch',
      'toggle',
    ],
    text: `Settings → Spark groups: You and Spark (What should Spark call you?, Personality: Playful, Friendly or Just the facts); How Spark works (How much Spark does alone, Wait before going on without your answer: 30s/60s/2 min/5 min/Never/Custom); Pull requests (Open pull requests as: Ready for review or Draft, PR follow-up: fix failing checks, handle review comments, reply on GitHub); Around the app (Morning brief and its time, Status companion: Scout shows what needs you; in the Mac app, Show Spark Island and its Quick chat and Sessions shortcuts).

There is no switch between a Spark workflow and a direct agent: every chat goes straight to the agent you pick, and approvals and safety always apply.`,
  },
  {
    id: 'settings-sections',
    title: 'Settings sections',
    keywords: [
      'settings',
      'preferences',
      'appearance',
      'theme',
      'reset',
      'usage',
      'models',
      'projects',
      'connectors',
    ],
    text: `Settings has these sections: Spark (see settings-spark); AI providers (a tile and screen each for Claude, Codex, Z.ai, Custom endpoint and Jev); Models (cost, benchmark and when Spark uses each model); Usage (tokens and cost per provider and category, last 30 days or all time); Projects (linked folders, trust and Where Spark works); Connectors (GitHub, Jira, Linear, Slack); MCP servers; Appearance (themes); Reset (hold to reset, then 10 seconds to Undo; optionally Keep my API keys).

spark_settings returns the non-secret settings; spark_projects returns each project's Where Spark works.`,
  },
  {
    id: 'today-so-far',
    title: 'Today so far and Home',
    keywords: ['today', 'today so far', 'home', 'new chat', 'greeting'],
    text: `A new, empty chat greets you by name in Spark's voice and shows Today so far: today's numbers (such as chats, what needs you and spend) and the latest chats with their state; each opens that chat. A quiet day gets a short line instead. spark_activity returns the same kind of summary for any number of hours.`,
  },
  {
    id: 'analytics',
    title: 'Analytics and spend',
    keywords: ['analytics', 'spend', 'cost', 'health'],
    text: `Analytics shows Overview and Spend over the last 7, 30 or 90 days, all computed locally from this workspace's own history — nothing is sent anywhere except what you ask "Ask about this view" to explain.

Overview covers turns, runs, cost, outcomes (good/bad/mixed), keep and revert rates and a 0–100 health score. Spend breaks down reported and estimated cost by project, provider and model, cost per task and per good outcome, and Jev's own spend. The spark_analytics tool returns the same reports for a chosen window.`,
  },
  {
    id: 'audit-log',
    title: 'The audit log',
    keywords: ['audit', 'audit log', 'protocol log', 'hash chain', 'verify'],
    text: `Every agent run's full protocol traffic — every JSON-RPC message to and from the agent, redacted — is recorded to a per-run, hash-chained audit log, along with Spark's own entries like approvals and Ship attempts. Secrets (API keys, tokens, passwords, secret-file contents) are redacted before anything is stored.

The chain lets Spark detect tampering: verifying it walks every row and reports the first broken one. Logs are retained 90 days by default and can be exported per conversation as JSONL or CSV. spark_audit reads a run's log for troubleshooting a specific run.`,
  },
  {
    id: 'desktop-app',
    title: 'The desktop app (Electron)',
    keywords: ['desktop', 'electron', 'app', 'packaging'],
    text: `The desktop shell is Electron, kept thin: the same web app in the renderer, the API and worker in their own processes, and a bundled PostgreSQL. Local API calls need a per-launch token so nothing else on the machine can reach them. A separate Dev channel (own app ID, data folder, database, branch prefix) never touches the installed app's data.`,
  },
  {
    id: 'browser-pane',
    title: 'The Browser pane',
    keywords: ['browser', 'pane', 'page', 'screenshot', 'localhost', 'dev server', 'console'],
    text: `Mac app: each chat has a Browser pane (Work panel → Browser). The user browses anywhere and watches. Agents open any http(s) address or project file, read an outline, text, screenshot or logs, and act with spark_browser_act (click, type, keys, scroll, back). Page content is untrusted. A site outside this computer follows the agent mode; acting on a tab the user owns always asks. Never typed by agents: password, card and code fields. Refused: Spark's own ports. Your tabs share the user's pane cookies and sign-ins (one profile for every chat); devtools storage never shows cookie values and masks auth-looking ones. Saved sign-ins (Settings → Projects): spark_browser_sign_in types a test login after a card; you never see the values. Dev server: spark_browser_preview.`,
  },
  {
    id: 'heartbeat',
    title: 'Anonymous heartbeat',
    keywords: ['heartbeat', 'telemetry', 'privacy', 'analytics', 'install', 'country', 'tracking'],
    text: `The Mac app sends a daily anonymous heartbeat: random install ID, version, OS. Cloudflare adds the country. Turn off: Settings → Help → Send anonymous heartbeat.`,
  },
];
