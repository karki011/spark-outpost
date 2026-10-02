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
    keywords: ['jev', 'advisor', 'typesafe', 'system one', 'judgment', 'check changes'],
    text: `Jev (TypeSafe's "System One") is an optional decision service, not a chat or coding model — it doesn't generate text, stream, call tools or edit files. It answers typed questions (Choice, Score, Noul) with calibrated probabilities over a short state you send it.

Spark uses Jev for a handful of concrete judgments per Do turn: whether a message is a question or a change, whether it's vague enough to need clarifying, whether it looks destructive, whether a Critic review is warranted, and a verifier check on the finished diff. Code always owns the policy and the act line for each question; Jev's answer only decides at high confidence, and low-confidence answers fall back to plain rules. With Spark off, Jev is never called. Answers below the confidence band never grant anything by themselves. Settings → AI providers → Check changes with Jev lets Jev verify finished diffs (never used for training).`,
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
      'make the change',
      'run a command',
    ],
    text: `A chat without a linked project answers from the conversation; it can't touch files or run commands, but agents can still use Spark's own spark_* tools. Link one or more project folders and a chat becomes Ask or Do, depending on the agent mode you pick.

Ask: the agent reads the folders and runs read-only commands directly. Other commands run without asking at Automatic or in an Auto or Bypass mode, and show a "Run a command?" card otherwise. Changing files, installing or pushing is refused — press Make the change for Do work. Do: the agent may also edit files and run commands.

Agent modes come from the provider, with its own names: Claude offers Manual, Accept edits, Plan, Auto (default) and Bypass permissions; Codex offers Read-only, Ask every time, Approve for me and Full access. Read-only modes are Ask; the rest are Do. The harness autonomy level is a separate choice.`,
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
      'how much spark does alone',
    ],
    text: `Alongside the agent's own mode, Spark has a harness autonomy with three levels. Set the default for new chats in Settings → Spark → How much Spark does alone; each chat can pick its own in its permissions.

Review each step: you decide whether to keep the changes, see the Critic's findings before any fix, and get a card before risky work starts.

Automatic (default): runs commands without asking in this chat's worktree and in Ask turns (which never change files); still asks for risky ones and for pushes. Changes are kept when the checks pass, the Critic's findings are fixed in a loop, and risky work runs in a worktree copy. Revert is always there.

Full auto → PR: Automatic, in a worktree copy, then Ship commits, pushes the task branch and opens a PR (Open pull requests as: ready or draft). Nothing ever merges. When checks still fail in Full auto: Open a draft PR (marked "Checks failing") or Stop and ask.

The safety floor holds at every level.`,
  },
  {
    id: 'read-then-send',
    title: 'Read, then send',
    keywords: ['exfiltration', 'curl', 'sensitive', 'network', 'egress', 'secret', 'send data'],
    text: `Once a chat has seen sensitive data — a secret file you allowed, secret values in a tool's output (env, printenv, config dumps) or private work data from spark_tickets, spark_chat, spark_audit, spark_pr and similar tools — anything that sends data off this computer asks first, at every level including Full auto and Bypass permissions: curl, wget, ssh, scp, nc, dig, git push, gh and cloud CLIs, package publishing, one-liners that open connections, user MCP tools and web fetches. The card names what was read (never values) and where the data would go. Requests to localhost stay unasked; the allowlist, run rules and Always allow can't skip it.`,
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
      'spend cap',
    ],
    text: `Every agent action that isn't pre-approved goes through the backend's approval gate, which enforces a floor no mode or level loosens: secret files (.env, keys, credentials) always ask or are refused; Builders never publish (git push, remote changes and gh/hub/glab are refused — only Ship pushes); no writes outside the linked folders; every command and decision goes to a hash-chained audit log.

Force pushes: git push --force-with-lease to a named, non-default branch always asks with a "Force push?" card you press and hold to confirm, with no Always allow. Plain --force, +refspec, mirror, unnamed and default-branch force pushes are refused.

Budgets cap each task: active time, tool calls and cost (Settings → Spark → Spend cap per task). A spent budget stops and asks. "Always allow" becomes a scoped rule, never a bypass of the floor.`,
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

In its own worktree, a chat's first build turn creates a git worktree under .spark/worktrees on a new spark/<title>-<id> branch, reused by every later turn, so chats work side by side and your folder stays as it is. Answers, plans and reviews don't create one. The keep card offers Bring changes into your branch, Ship, or leaving the work on the chat branch. The worktree is released on archive, delete (unpushed work stays on the branch), merge and Reset.

In my files, new chats edit the folder directly. Spark still uses a private worktree copy for Full auto → PR, provider modes that skip the gate, a second task in the same repo, and destructive or risky work; the copy merges back after each turn, with a card if your files changed meanwhile.`,
  },
  {
    id: 'coordinator',
    title: 'The coordinator and pieces',
    keywords: ['coordinator', 'pieces', 'integrator', 'shared tree', 'piece list', 'split'],
    text: `Small and medium work takes the lean path: one Builder, checks with fix turns, and a Critic by rule. For a story too big for one Builder, or one you ask to split, the coordinator plans it into Builder-sized pieces with declared file ownership. Independent pieces run at the same time (up to the project's Builders at once), dependents wait. Pieces run in a shared tree (the chat's worktree, each Builder limited to its own files by the approval gate) or in their own worktree copies for long, destructive or isolated work; each copy lands once its scoped checks pass.

At Review each step, a parallel list or one with 5+ pieces shows a card: Build it, Build in order instead, Revise, or Stop. Builders never stash, checkout, reset, commit, merge or rebase; the integrator resolves conflicts, renumbers colliding migrations and runs the full checks once before the Critic.`,
  },
  {
    id: 'builders-at-once',
    title: 'Builders at once: one at a time or in parallel',
    keywords: [
      'builders at once',
      'at once',
      'one at a time',
      'in order',
      'serial',
      'sequential',
      'parallel',
      'slots',
      'concurrent',
      'builder',
    ],
    text: `Settings → Projects → Builders at once sets, per project, how many Builders a big plan's pieces may use at the same time: 1 at a time, in order; Up to 2 at once; or Up to 3 at once (the default, so pieces run in parallel by default). More at once finishes sooner and spends faster.

To make Builders run one at a time, open Settings → Projects and pick "1 at a time, in order" for that project. At Review each step you can also choose Build in order instead on the piece-list card for one plan.

Spark drops to one at a time on its own while the provider is rate limited. If the server runs with COORDINATOR_MODE set to anything but parallel (the default), every project builds in order and the setting is unavailable. spark_projects shows each project's current value as buildersAtOnce.`,
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
    title: 'Ship: commit, push, open a PR',
    keywords: ['ship', 'commit', 'push', 'draft pr', 'pull request', 'merge', 'ready for review'],
    text: `Ship turns a chat's changes into git history: commit only, push, or open a pull request. Settings → Spark → Open pull requests as picks Ready for review (default) or Draft; a Full auto PR whose checks still fail is always a draft marked "Checks failing". Ship never merges anything — that stays your decision. It refuses to push a branch that carries Spark's own internal snapshot commits, and only pushes its own single-level spark/<slug>-<id> branches, never a raw worktree branch.

In a chat worktree, the keep card offers "Bring changes into <your branch>", "Open PR" (Ship), or leaving the work on the chat's own branch. At Full auto → PR, Ship runs automatically after an auto-decided keep: it opens a PR when GitHub is connected, otherwise pushes, or commits only when there's no remote — and the result always includes the link.`,
  },
  {
    id: 'pr-follow-up',
    title: 'PR follow-up: Spark handles checks and review feedback',
    keywords: ['follow up', 'review comments', 'failing checks', 'reply', 'copilot', 'coderabbit'],
    text: `After Spark opens a PR from a chat it watches it until merged or closed: failing checks, review comments, reviews and PR comments, bots included. Jev triages each item (rules without Jev): fix, question, needs you, nit, already addressed, information. Spark acts only on failing checks and comments from people with write access; others are shown, never acted on, and disagreements go to you. A Builder fixes everything in one round in the chat's worktree; the push and replies ("Fixed in <sha>: …") need one confirm card in Review each step and Automatic, none in Full auto. Never force-pushes, merges, approves, resolves threads or dismisses reviews; 3 rounds per PR. Tools: spark_pr_follow_up, spark_pr_follow_up_round.`,
  },
  {
    id: 'tickets',
    title: 'Tickets inbox, links to chats and PRs',
    keywords: ['ticket', 'jira', 'linear', 'inbox', 'attention', 'link', 'unlink', 'priority'],
    text: `Tickets pulls your Jira and Linear tickets (connect them in Settings → Connectors) into one inbox: Needs attention first, then Working, PR ready, In review and Up next. Each row shows status, priority, why it is flagged, due date, and a links column with the chat (with its state) and the PR (draft, open, checks failing, changes requested, approved, merged, closed).

A build turn that names exactly one ticket links the chat to it; references like "see" or "similar to", or several keys, only suggest. Linked chats show a "KEY · title" chip with Unlink and Undo, their branch starts with the key, and Ship puts the key in the PR title. Mentions never move a ticket's status.

spark_tickets returns the same live data; use sort=priority for the most urgent ticket.`,
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
    text: `The Map page (in the side rail) draws each linked repository as a sky of files grouped into areas, with links between areas and between repositories (front end to back end, shared packages, shared env keys). Filter areas by category (Core, Shared, Feature), files by kind, and links between projects; open a file for Jev's label, a preview, what depends on it, its imports and its history ("Changed 3 days ago · 5 commits · 2 authors"). With 2+ projects it lists unmatched API: routes nothing calls and calls that reach no route.

The Map builds in the worker at low priority, pauses while an agent runs, and updates as commits land. Areas are labelled by rule or, with Jev connected, by one call per area using only non-secret files. Changes that touch Core areas are highlighted as Core impact on the keep card, the Changes pane and the PR description. spark_map returns a project's areas.`,
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
    keywords: ['spark_', 'tools', 'mcp server', 'spark tools', 'self-service', 'action card'],
    text: `Every agent session Spark launches (chat, Ask, Do, Builders; Claude, Z.ai and Codex) gets a built-in MCP server named "spark", so agents can answer questions about Spark without guessing.

Read tools need no approval card; section spark-tools says which one answers which question.

Action tools: spark_create_ticket, spark_comment_ticket, spark_transition_ticket, spark_assign_ticket, spark_open_pr and spark_pr_follow_up_round. Each shows a card previewing exactly what will change; you may edit the text, and nothing happens until you confirm. There is no Always allow and autonomy levels never decide these cards. Every action is audited.`,
  },
  {
    id: 'spark-tools',
    title: 'Which Spark tool answers which question',
    keywords: ['which tool', 'spark_', 'tools', 'ask spark', 'question', 'answer', 'index'],
    text: `Needs me? spark_attention. A chat's live run, crew, pieces and Jev decisions: spark_run. Plan and files changed: spark_task. Chats and messages: spark_chats, spark_chat. Compacted turns: spark_chat_history. Agent steps: spark_audit. Recent work: spark_activity, spark_brief.
Spend: spark_spend. Trends and outcomes: spark_analytics. Model price, strengths and pass rates: spark_models.
Agents: spark_providers. GitHub, Jira, Linear, MCP: spark_connectors. Settings: spark_settings. Projects: spark_projects. Areas, or what a file change breaks: spark_map. Open terminals (never output): spark_terminals. Tickets: spark_tickets. PRs: spark_pull_requests, spark_pr. Spark's follow-up on its PRs: spark_pr_follow_up. Estimates, budgets, removal findings, demotions: spark_laws. How Spark works: spark_guide. User guide how-tos: spark_docs.`,
  },
  {
    id: 'compaction',
    title: 'When a chat gets full: compaction',
    keywords: ['compact', 'compaction', 'context', 'full', 'ring', 'summary', 'tokens'],
    text: `The ring warns at 60%; Spark compacts at 80% between turns (both in Settings → Spark, spark_settings). Review each step asks: Compact now, a fresh chat with a summary, or Keep going; Automatic uses the agent's /compact or a Spark summary; with automatic compaction off it always asks. A divider shows it. spark_chat_history reads earlier turns.`,
  },
  {
    id: 'settings-spark',
    title: 'Settings → Spark',
    keywords: [
      'settings',
      'spark switch',
      'personality',
      'name',
      'companion',
      'spark island',
      'scout',
      'switch',
      'toggle',
    ],
    text: `Settings → Spark groups: You and Spark (What should Spark call you?, Personality: Playful, Friendly or Just the facts); How Spark works (the Spark switch, How much Spark does alone, Spend cap per task, If you don’t answer a question: Off, 10s, 30s or 60s before Spark picks the safe option); Pull requests (Open pull requests as: Ready for review or Draft, When checks still fail in Full auto, Follow up on pull requests with Fix failing checks, Handle review comments and Reply on GitHub threads); Around the app (Morning brief and its time, Status companion: Scout floats in a corner outside open chats showing what needs you; in the Mac app, Show Spark Island and its Quick chat and Sessions shortcuts).

The Spark switch on: Jev reads each request, routing picks models, a Critic reviews bigger changes and Jev checks finished work. Off: chats go straight to the agent you pick. Approvals and safety apply either way. On/off switches are blob toggles that turn green when on.`,
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
    text: `Settings has these sections: Spark (see settings-spark); AI providers (connect Claude, Codex, Z.ai and Jev, and Check changes with Jev); Models (cost, benchmark and when Spark uses each model); Usage (tokens and cost per provider and category, last 30 days or all time); Projects (linked folders, trust, Builders at once and Where Spark works); Connectors (GitHub, Jira, Linear); MCP servers; Appearance (themes); Reset (hold to reset, then 10 seconds to Undo; optionally Keep my API keys).

spark_settings returns the non-secret settings; spark_projects returns each project's Builders at once and Where Spark works.`,
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
