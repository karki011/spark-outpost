# Routing plan

> **Status.** Rollout steps 0 (code scan, [codescan-2026-09-27.md](../benchmarks/codescan-2026-09-27.md)) and 1 (shadow, [routing-shadow-2026-09-27.md](../benchmarks/routing-shadow-2026-09-27.md)) are built: the scan, the Jev file ranking and the route question run for every Do task and are recorded next to the rule route (`run_advice` purposes `scan`, `rank` and `route_shadow`; the `routing_labels` view; `pnpm routing:labels`). The Builder still runs on the rules in `orchestration/routing.ts` and `risk-rules.ts`, with a floor: the harness never picks the fast tier or a retiring model for any role, and a Builder gets the top tier only for complex work (section 4; evidence in [routing-live-2026-09-27.md](../benchmarks/routing-live-2026-09-27.md)). Since September 30 the Builder's model on Auto comes from a legible route score (expected quality minus a cost penalty, with a cache-switching penalty that keeps a warm task session, all in expected dollars including repair) over Jev's four intake ratings or the rules' estimates (section 12); with the rules alone it picks exactly what the rules did. A hard follow-up in a long task session escalates through a handoff (a stronger Builder with a brief, or compact then switch) instead of re-reading the whole context (§12, policy `route-score-2-escalation-routes`); pass-rate evidence for those routes is pending. Steps 2–5 are open.

This plan replaces keyword routing with a Jev decision that uses codebase evidence, and then checks the result before paying for a stronger model. It draws on six routers read in full, including their code, fixtures and studies.

## What the research taught us

| Source                                                                                                                                           | What it does                                                                                                                                                     | What we take                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [pi-model-router](https://github.com/alexei-led/pi-model-router)                                                                                 | One structured Jev Choice over model × effort candidates, once per user turn. Cumulative-probability acceptance. Published studies on a 24-task labelled corpus. | The question design, the acceptance rule, route reuse inside a turn, the failure table and the evaluation honesty. The strongest source. |
| [OpenRouter verified cascade](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-verified-cascade)                                    | Cheap draft, then a Jev three-way verdict (supported, unsupported, declined), escalate on doubt. 0 wrong of 50 at 7% of the frontier cost.                       | Verify the outcome instead of predicting difficulty perfectly.                                                                           |
| [Mandrilsquad jev-model-router](https://glama.ai/mcp/servers/Mandrilsquad1441/jev-model-router)                                                  | Difficulty levels described as situations, wording A/B-tested on 42 labelled tasks, a coding-agent cost model.                                                   | Describe tiers as situations, test wording against labels, estimate cost from calls × context.                                           |
| [Neurycode use cases](https://neurycode.com/blog/jev-use-cases)                                                                                  | Two-stage Choice ranking (182 skills → top 3 → rerank), a four-question diff verify, codebase reflexes.                                                          | Two-stage ranking for candidate files, and diff verification.                                                                            |
| [AWS Builder article](https://builder.aws.com/content/3JoJL1whRdHoUerKMxjg23g2rNe/jev-as-an-llm-router-fast-typed-decisions-for-model-selection) | Route Choice plus complexity Score. Confidence below 0.6 or "hard" → frontier.                                                                                   | Jev decides, code owns the policy. A "hard" answer upgrades.                                                                             |
| [lucianfialho jev-model-router](https://github.com/lucianfialho/jev-model-router)                                                                | Complexity → price percentile, 8-prompt eval.                                                                                                                    | Little beyond the shared principle.                                                                                                      |

### Ten lessons

1. **Jev advises, code decides.** Every router keeps the policy (pins, budget, safety, fallbacks) in plain, testable code, and lets Jev choose only among candidates the code offers. Jev cannot add a model or authorise a tool.
2. **One well-written question beats many.** pi's study added two Noul questions to the route Choice: they changed 0 of 72 routes and cost about 190 tokens each. Mandrilsquad's 11 questions were never shown to beat one. Start with one Choice.
3. **Describe tiers as situations, with limits.** Each option carries `covers`, `useWhen`, `notFor` and `examples` (pi), or a situation description (Mandrilsquad). Structured criteria moved pi's hardest task to the right tier.
4. **Tell Jev what not to use.** pi's instructions say: do not infer capability from prompt length, file count, language, punctuation, urgency or isolated topic words. That is exactly what our `TRIVIAL_VERB` rule does, and why it can't scale.
5. **Give an honest "uncertain" option.** Abstention is for work that is unclear, not merely hard or missing facts. It routes to the baseline, or for us, to a clarifying question.
6. **Don't throw away a low-confidence answer.** Below the confidence bar, pi adds probability from the cheapest tier upward and takes the first tier that reaches 0.8. On 96 answers that gave 92 correct tiers versus 83 for "fall back to top". AWS falls back to frontier, which is safe but expensive.
7. **Less context, chosen well.** pi found more history did not help. What helped: the current request first, the beginning and end of long text, and the last _failing_ tool result (it raised confidence from 39% to 83–87%). An unrelated successful result lowered it.
8. **Decide once per unit of work.** pi routes on a new user turn and keeps the route for every tool continuation. Switching mid-loop rereads the whole context uncached. For us the unit is a Do task.
9. **Verify the outcome.** Predicting difficulty is imperfect. The OpenRouter cascade starts cheap and lets a verifier decide when to escalate. A chosen route is not a correct answer (pi says this plainly).
10. **Measure honestly.** Label a corpus, A/B the wording, run a fixed-model control, and call estimates estimates. pi's evaluation refuses to claim savings it didn't measure.

### What none of them do

All six judge **text only**. None looks at the repository before routing. A coding request's difficulty depends on the code: "rename `fmt`" is trivial in one file and risky across 40 call sites. Codebase evidence is our addition, and we must prove it helps, since pi showed extra context can hurt.

## Direction for the harness

```
User message (Do)
  │
  ▼
Jev intake (built)            question · vague · review · destructive · continues_task · injection
  │
  ▼
Code scan (new, local)        identifiers → ripgrep → symbols → up to 255 candidate files
  │
  ▼
Jev file ranking (new)        one Choice over the candidates (the rerank was dropped)
  │
  ▼
Policy in code                pin > destructive → top > budget > one candidate
  │  (else)
  ▼
Jev route Choice (new)        model candidates, structured criteria, uncertain
  │  confidence ≥ 0.65 → top option
  │  otherwise → cumulative from cheapest to 0.8
  │  uncertain → ask (vague) or the chat model
  ▼
Builder subagent              keeps its route for the whole task
  │
  ▼
Checks + Jev diff verdict     supported / unsupported / declined
  │  supported → done
  │  unsupported → one tier up, once
  │  declined → hand back to the user
  ▼
Critic (unchanged)            destructive, review request, or large diff
```

### 1. Candidates

Candidates are the connected providers' models that the probe reports. Each carries a neutral tier (`micro`, `low`, `mid`, `top`) mapped by config, not by name. The candidate list is the only thing Jev can pick from.

**Effort is not routed in the first build.** Each provider gets a default effort, chosen by the user when connecting it (a new setting; today effort only lives on each chat's pick). The Builder runs at that effort. If the user never chose one, it's the chat's own effort, then the model card's `defaultEffort`. The only automatic change is the existing one: an escalation raises effort one step. Letting Jev pick model × effort (as pi does) comes later, once our labels show it helps.

### 2. Code scan (our addition)

Our own server scans the project locally, before any agent starts. Jev can't read files, and asking the agent to explore would cost the model turn that routing is meant to save. An LSP server is too heavy to start per task: one server per language, the project's dependencies installed, and a slow index.

#### Libraries

| Library                                                            | Version checked | Role                                                                                                          |
| ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------- |
| [`@vscode/ripgrep`](https://www.npmjs.com/package/@vscode/ripgrep) | 1.18.0          | Bundled ripgrep binary: live text search that respects `.gitignore`. VS Code's own search uses it.            |
| [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter) | 0.27.0          | Parses files into definitions and references. WebAssembly, so no native build. One grammar file per language. |
| [`ignore`](https://www.npmjs.com/package/ignore)                   | 7.0.10          | `.gitignore` rules for the indexer's own file walk.                                                           |
| `git` (already required)                                           | –               | `git ls-files`, changed files since the cached commit, and co-change history.                                 |

**Grammars: one package covers most languages.** [`@vscode/tree-sitter-wasm`](https://www.npmjs.com/package/@vscode/tree-sitter-wasm) (0.3.1, 2 MB, maintained by Microsoft for VS Code) ships a matched tree-sitter runtime plus 16 grammars: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, C#, C++, Ruby, PHP, Bash, PowerShell, CSS, INI and regex. That is the first build. [`tree-sitter-wasms`](https://www.npmjs.com/package/tree-sitter-wasms) (0.1.13, 4.5 MB, 36 grammars) adds Kotlin, Swift, Dart, Scala, Vue, Elixir, Lua, Zig, YAML, TOML, JSON and HTML; it's the extension if the prototype shows its grammars load in the same runtime. Any other language falls back to ripgrep only.

The ranking copies the technique of [Aider's repo map](https://aider.chat/docs/repomap.html): tree-sitter tags, then a PageRank-style score over "which file references which", weighted towards the files and symbols the request names. `@ast-grep/napi` is the fallback if `web-tree-sitter` proves too slow. Zoekt (huge monorepos) and SCIP indexers (exact references) are later options, not part of the first build.

#### Everything the scan reads, in one place

| Source                  | Tool                                                                                                                                                      | When                        | What it gives                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tracked files           | `git ls-files`                                                                                                                                            | Index                       | The file list, already filtered by `.gitignore`.                                                                                |
| Working changes         | `git status --porcelain`                                                                                                                                  | Every task                  | Uncommitted and untracked files: what the user is working on now.                                                               |
| Changes since the index | `git diff --name-only <cached>..HEAD`                                                                                                                     | Reopen, branch switch, pull | Which files to re-parse.                                                                                                        |
| History                 | `git log --name-only` (last ~500 commits)                                                                                                                 | Index, refreshed daily      | Churn per file, and files that change together.                                                                                 |
| Current branch          | `git rev-parse`, `git branch --show-current`                                                                                                              | Every task                  | Cache key; branch name as a hint of the task's area.                                                                            |
| Workspace layout        | `pnpm-workspace.yaml`, `package.json` workspaces, `nx.json` + `project.json`, `turbo.json`, `go.mod`/`go.work`, `Cargo.toml` workspaces, `pyproject.toml` | Index                       | Package boundaries: which package each file belongs to. "Spread across 6 packages" is a strong difficulty signal in a monorepo. |
| Package dependencies    | Each package's manifest, `tsconfig` `paths`                                                                                                               | Index                       | The package graph: who depends on whom, so a change in a shared library counts as wider.                                        |
| Project instructions    | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `CONTRIBUTING.md`                                                                                              | Index                       | Existence and location only (they're passed to the agent, not to Jev).                                                          |
| Ownership               | `CODEOWNERS`                                                                                                                                              | Index                       | How many owners a change touches.                                                                                               |
| Tests                   | File naming (`*.test.*`, `*.spec.*`, `__tests__`, `test_*.py`, `*_test.go`)                                                                               | Index                       | Which test files sit next to each source file.                                                                                  |
| Symbols                 | `web-tree-sitter`                                                                                                                                         | Index, then changed files   | Definitions and references per file.                                                                                            |
| Text matches            | ripgrep                                                                                                                                                   | Every task                  | Live matches for the request's identifiers, always current.                                                                     |
| Languages               | File extensions                                                                                                                                           | Index                       | Which grammar to use; the project's language mix.                                                                               |

Nothing reads file contents into the Jev state, and nothing runs project code (no `npm install`, no build, no LSP).

#### Steps per task

1. **Pull identifiers from the request:** paths, file names, `CamelCase` and `snake_case` words, quoted names.
2. **Search live with ripgrep:** which files contain them, and how often.
3. **Look up the symbol cache:** where each name is defined, and how many files reference it (one file or 40).
4. **Add git and workspace signals:** the user's uncommitted files, files changed together recently, churn, and which packages the matches fall in.
5. **Rank:** the reference-graph score plus the matches, up to 255 candidate files. Jev's Choice then orders the top files. A second rerank Choice was built and dropped: in the first live run it never changed the top file (see the shadow benchmark).

Steps 1–4 are plain local code and cost no model tokens.

#### What Jev receives

- the request, first; long text keeps its beginning and end;
- the top-ranked files, each with its line count, symbol count, reference count and recent churn;
- the last failing check or tool result for a follow-up, and nothing that succeeded;
- at most two prior turns.

No file contents, system prompts, tool arguments or secrets. State fields are marked as untrusted data, never instructions. The budget is about 3,000 tokens, as in pi.

#### Speed and concurrency

The UI runs in the browser and the API in its own process, so a scan can never freeze the UI. At worst a task's routing starts late.

- **The scan runs in the workflow worker,** not the API. ripgrep and `git` are child processes, and parsing runs in a worker thread, so the worker's event loop stays free.
- **At most 2 scans at once;** the rest queue. Five chats in five projects don't fight over CPU and disk.
- **Lowered process priority** (`nice`), so the agents and the user's editor come first.
- **A deadline of 1–2 s per task scan.** At the deadline it returns what it has; with nothing, routing uses the request text alone. A task never waits on a scan.
- **It overlaps other work:** Jev intake (about 0.5–1 s) and the agent session start (several seconds) run at the same time.
- **Parsing happens ahead of time:** a project is indexed in the background when it's opened, so a task only searches and reads the cache (milliseconds).

#### Cache across restarts

The index lives in Postgres (tables in the app's own database, never in the user's repo), one row per file:

| Field                         | Purpose                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| project, path                 | Key.                                                                                    |
| size, mtime, content hash     | Detect changes.                                                                         |
| parser version                | An upgraded parser or grammar discards old rows.                                        |
| definitions, referenced names | Symbol names and kinds, and the IDs of the names the file references. No file contents. |

Each project also stores its last indexed commit and when it was last opened.

**Reopening the app or a project:**

1. **Git repos:** `git diff --name-only <cached>..HEAD` plus `git status` lists everything that changed while the app was closed, including branch switches and pulls.
2. **Anything else** (untracked files, or a non-git folder): compare size and mtime, and hash only the mismatches.
3. **Re-parse only the changed files,** in the background.
4. **A task that starts before the refresh finishes** uses the cache plus live ripgrep, so its text matches are always current.

The cache is a speed-up, never the source of truth. Anything inconsistent, such as a corrupt row or an unknown parser version, is rebuilt from scratch.

#### Growth limits

Rows are overwritten, never appended, so the cache grows with project size, not with time or the number of tasks. Rough estimates (to be measured): 2–5 KB per file, so about 20–50 MB for a 10,000-file repo and 200–500 MB for a 100,000-file monorepo.

- **Skipped:** ignored files, `node_modules`, `vendor`, build output, lockfiles, minified or generated code, large and binary files.
- **Identifier names stored once per project,** referenced by ID.
- **Per-project cap,** for example 50,000 files. Beyond it, only recently changed files and those near past tasks are indexed; ripgrep still searches everything live.
- **Global cap,** for example 500 MB. Past it, the cache drops the least recently opened project.
- **Expiry:** projects not opened for 30 days lose their index; removing a project deletes its rows at once.
- **Settings** shows the cache size and a Clear cache button. Clearing only costs one rebuild.

Task history (transcripts, events, runs) will outgrow this cache long before the cache matters. It needs its own retention setting (queued separately).

### 3. The route question

One Choice with pi-style criteria written for coding tasks, one option per candidate, plus `uncertain`. The instructions ask for the best expected result, favouring correctness and less rework over cost, and forbid judging by length, file count or topic words alone. The acceptance rule is pi's: take the top option at confidence ≥ 0.65, otherwise take the cheapest tier whose cumulative probability reaches 0.8.

Thresholds and wording start from pi's values and are then fitted on our own labelled data (step 6).

### 4. Policy that stays in code

- **Pinned** model: used as is, no Jev call, except for the Builder floor below. A pinned retiring model still runs for Scouts and answers, with the note "<model> retiring on <date>".
- **Destructive** work → the top tier. This is a safety gate, not a difficulty guess, so it stays deterministic (keyword rule OR Jev's destructive answer, as today).
- **Harness floor** (September 28, `orchestration/model-floor.ts`, policy `fixturn-3-devday-rerun-nohaiku`). The Builder floor below now covers every role the harness picks a model for: Scouts and chat answers on Auto, the Critic, retries and cascade reruns (`escalate`), the trivial rule (now "trivial → middle tier"), route fallbacks, the digest model, Jev's tier pick for a Scout (`autoWouldUse`) and a resumed Scout session. Each resolves the middle tier from the provider's live model list by tier (the lowest model at tier 1 or above), never by name. A model is **retiring** when its card's `retiresNotBefore` is on or before today + 30 days (`cardRetiring` in `model-cards/cards.ts`); the harness never picks a retiring model, and a retiring pick at the middle tier or above is raised with "raised to <model>: <old> retires on <date>". Jev still sees retiring and fast-tier models as route candidates; its pick is recorded as it answered and mapped to the middle tier for what would run (`raisedTo`, and `runs` in `pnpm routing:labels`). A model the user pins for a chat still runs, with the retiring note. Provider defaults and the chat default never resolve to a retiring model (`effectiveDefaultModel`, `usableDefault`); `0051_retiring_defaults.sql` reset stored connection defaults on Haiku 4.5 or GPT-5.5 to the provider's default, and per-chat picks are kept.
- **Builder floor** (built September 28, policy `floor-1`, `orchestration/model-floor.ts`). A Builder never runs on the small tier. Whatever picked it (the rules, a pinned or small chat model, a cascade rerun, a resumed session, Jev's tier pick or its route answer), a small-tier pick moves to the lowest model at tier 1 or above in the provider's current list; the note reads "raised to <model>: Builders don't run on the fast tier". Tiers come from the model cards and name patterns, never from hardcoded ids, so a retired middle model means the next one up. A model whose tier is unknown stays eligible and is noted ("tier unknown for …"); with nothing stronger the pick stays and the note says so. The shadow record keeps Jev's own choice as `pick` (the label) and adds `raisedTo`. The note shows on the route decision (summary, `answer.note`, the why line), in the Builder's header (`routeNote`) and in the model picker's hint; a small-tier task session is not resumed for a Builder, and Settings → Models tags retiring models "Retiring <date> · not used by the harness". The live round's reason: a Haiku Builder failed 4 of 22 runs silently, Sonnet passed 32 of 32, and one silent failure costs about 500 times the per-task saving.
- **Complex work → the top tier** (`orchestration/builder-complexity.ts`; since September 30 the complex signal feeds the route score as complexity 4, see §12). The user asks for the top model; the request is a migration, security work or spans several packages; the code scan (only if already finished) matches 15+ files or 3+ packages and the request is broad (broad wording, several parts, or Jev's complexity or top tier), unless it is a one-line fix or Jev's small tier is at 0.8 or more (`complexByBreadth`); or Jev's intake tier is top at 0.8 or more. The rule reads "complex → top tier (reason)", and a task session on another tier is not resumed for it. Otherwise the middle tier: Opus bought no extra passes in the live round, and Jev's Opus picks there were all at 0.62 or less.
- **Daily cost cap** (queued feature): when reached, the cheapest eligible candidate.
- **One candidate**: no Jev call.
- **Context window**: skip candidates that can't hold the request at 90% fill.
- **Jev fails** (timeout, invalid, 429 after retry): the chat model. No second advisor.

### 5. Verified cascade

After the Builder finishes: checks run, then one Jev verdict on the diff against the task (supported, unsupported, declined, accepted at 0.8, as in the OpenRouter cascade). Unsupported → rerun once a tier up, in the same worktree, with the failure as evidence. Declined → stop and report. This replaces the retry-one-tier-up rule and gives us the outcome labels we need.

**Built on 2026-09-27** after a measurement on 24 labelled diffs (unsupported precision 0.91, recall 0.83; [verifier-2026-09-27.md](../benchmarks/verifier-2026-09-27.md)). Declined asks with a card rather than stopping outright. The retry one tier up for a failed Builder stays: it covers agent failures, which never reach the verdict.

### 6. Learn from our own runs

Every task records: candidates, Jev's distribution, the chosen route, the predicted files, the files actually changed, the checks, the verdict, the escalation, Keep or Revert, and the thumbs. That becomes the labelled corpus. The route question's wording and thresholds are A/B-tested on it, as pi and Mandrilsquad did, before any default changes.

### 7. Decompose later

Superseded by the coordinator, which splits large tasks into pieces with their own Builders and is on by default (`COORDINATOR_MODE` defaults to `parallel` in `apps/server/src/config.ts`). See [COORDINATOR_PLAN.md](COORDINATOR_PLAN.md).

### 8. Without Jev

Jev is optional. With no key, or with the service down, the harness still works on the rules: the code policy still applies (a pin, destructive work → the top tier, the Builder floor, complex work → the top tier by rule and scan, the cost cap), the code scan still runs (it's local), vague requests aren't caught by Jev, and there is no diff verdict, so checks and up to 2 fix turns decide.

**Spark off** (the user's switch) goes further: Jev is never called and no scan runs. The Builder runs once on the chat's own pick (`soloRoute`, rule "Spark off → your pick"), with no Critic, no retry one tier up and no "continue" for open plan items; risky work still asks first at Review each step. Where the Builder works (the chat's worktree or your checkout) follows the chat worktree rules in [HARNESS_PLAN.md](HARNESS_PLAN.md).

We don't add a second LLM classifier as a fallback (pi has one). It would cost a model call per task and needs its own evaluation; the chat's model is a sound default.

### 9. Switching provider mid-task

A provider switch doesn't have to lose the conversation, but it does lose the prompt cache. The cache lives on the provider's servers, so the new provider has to read the context once at full price. After that, it caches as usual.

- **The user can switch any time.** The new session gets a handoff: the task, the plan so far, the files changed, the last check results and the recent turns (the digest already builds most of this), not the whole transcript. That keeps the one uncached read small.
- **The router never switches provider on its own inside a task.** The escalation stays on the same provider; the Critic already uses the other provider in its own session.
- **Across turns the warm session wins** unless the score says the stronger model is worth the re-read (§12).
- **Same provider, different model:** also a new session in ACP today, so it pays the same one-time read.

### 10. Desktop app (Electron) and the database

See [ELECTRON_PLAN.md](ELECTRON_PLAN.md): the scan and agents stay out of Electron's main process, and the app keeps Postgres, bundled.

### 11. First test repo: `Cloudzero/feature-web-apps`

Cloned (read-only use) into the session scratchpad at `scratchpad/repos/feature-web-apps`. It's an internal company repository. The profile:

- 5,443 tracked files, 1,736 commits, 83 MB of git history;
- TypeScript almost entirely: 2,513 `.ts`, 1,799 `.tsx`, plus JSON, Markdown, YAML and a little Python and shell;
- an Nx + pnpm monorepo: 133 `project.json` projects under `libs/ui` (2,552 files), `libs/features` (1,264), `libs/foundations` (720) and `apps/web` (405);
- it has `CLAUDE.md`, `AGENTS.md` and `.claude/agents`;
- a warm ripgrep search for one identifier across the whole repo took 0.16 s (130 matching files).

It's a good test of the monorepo signals: one request can touch one Nx project or many. "Training" here means building a labelled task set and tuning our wording and thresholds; nothing trains Jev itself.

**Privacy:** the local scan never leaves the machine. Jev is an external service (TypeSafe), and its state includes this repo's file paths, symbol names and the task text. The user confirmed on 2026-09-27 that the company allows this for `feature-web-apps`. Other company repositories need their own confirmation.

### 12. Cache-aware routing and the route score (September 30, 2026, policy `route-score-1-cache-aware`)

Lessons taken from Cloudflare's Auto Router (https://blog.cloudflare.com/auto-router): a classifier gives task ratings, the model is chosen by expected quality minus a cost penalty that shrinks as the task gets harder, the cost that matters is the whole task's (not the token price), prompt caches dominate long agent sessions so switching models has a price that grows with the context, candidates are ranked with the rest as the fallback order, and every decision is legible.

#### What Spark did before this change (the A.1 audit)

Where a turn can change model or provider, and what that costs:

| Path                                                      | Session key                                    | Model between turns                                                                                                                | Cache                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Chat and Ask, Spark off                                   | `chat:<mode>`                                  | the chat's pick; changes only when the user changes model or effort, which closes the session ("Fresh session (settings changed)") | resumed turns send only the new message                                                                                      |
| Ask and in-place answers (Scout), Spark on                | `chat:ask`                                     | the chat model, floored; `keepScoutSession` keeps a resumable session's model on the same provider                                 | resumed                                                                                                                      |
| Do Builder, follow-up in the same task                    | `key:<task>:builder`                           | `session-keep.ts` kept the session's model unless destructive or complex work needed the top tier                                  | resumed                                                                                                                      |
| Do Builder, new task                                      | a new key                                      | always a fresh session: a new task closes the previous one                                                                         | the history is not reused; the provider's prefix cache (system prompt and tools) still hits on the same model within its TTL |
| Check fix turns, plan continues, Critic fix rounds        | the same key and the stored route (`s.routes`) | never switches                                                                                                                     | resumed                                                                                                                      |
| Escalation: a failed Builder, or a verifier "unsupported" | the same key, one tier up                      | **switches mid-loop**; the settings hash changes, so the rerun opens a fresh session and re-reads everything                       | the only in-loop switch; it acts on failure evidence                                                                         |
| Critic, including re-reviews in fix rounds                | none (an untracked child run)                  | another provider, a fresh session every review                                                                                     | re-reads request, plan and diff (24 KB cap) each time                                                                        |
| Clarify turn                                              | `chat:ask`                                     | the routed Scout; the next in-place turn resumes it                                                                                | resumed                                                                                                                      |
| Coordinator, pieces, integrator                           | their own keys                                 | pieces may run on another provider; each starts fresh                                                                              | none across pieces                                                                                                           |
| Spark off Do (`soloRoute`)                                | `key:<task>:builder`                           | always the chat's pick                                                                                                             | resumed                                                                                                                      |

Measured costs of switching and of resuming:

- **M6** (HARNESS_PLAN.md, Sessions): Claude turn 2 resumed $0.0013 and 4.8 s against $0.0155 and 7.9 s fresh; Codex uncached input fell 76–91% on resume.
- **The d4c59d3 regression** ([harness-e2e-live-2026-09-26.md](../benchmarks/harness-e2e-live-2026-09-26.md)): card routing picked Haiku for turn 1 and Sonnet for turn 2 of one task, the settings hash changed, and turn 2 cost $0.045–0.050 and 17–29 s against $0.015 and 10–11 s resumed (3×). `session-keep.ts` fixed it; the lean round measured turn 2 "Continued session" at $0.026 ([harness-e2e-lean-2026-09-27.md](../benchmarks/harness-e2e-lean-2026-09-27.md)).
- **Codex resume is not free:** `exec resume` re-read 160K input tokens against 82K, $0.07 against $0.036 (same report).
- **Dev history** (the September 28 backup of the dev database: 23 chats, 46 real runs; the current dev database was reset): resumed chat turns cost $0.012 each (11.5K cached read, 1.7K written) against $0.062 for the first turn; a chat from before provider sessions paid a 5.7–5.9K cache write every turn ($0.025 for replies of 13–50 tokens); switching that chat from Sonnet to Haiku dropped the cached read to 0; a Builder moved from Haiku to Sonnet mid-task wrote 17.6K ($0.073 for 116 output tokens, against $0.017 for the Haiku turn before it); a Scout moved from Opus to Sonnet paid a 10.4K write ($0.055), and the next, resumed Sonnet turn $0.029.
- **Prices** (`vendor-cards.json`): Claude cache reads are 0.1× input (0.05× Opus 5.5, 0.025× Fable 5.1) and writes 1.25×. At 48K of context, staying on a warm Sonnet 5 re-reads it for $0.0096; moving to Opus 5.5 re-reads it at the write price, $0.24, 25 times as much. Prompt caches expire after about 5 minutes (`PROMPT_CACHE_TTL_MS`); after that even the same model pays the write price again.
- **A bug:** `session-keep.ts` measured a session's context as the run's summed input, cache-read and cache-write tokens, which counts every call's re-read (one Haiku Builder run: 64K cached reads, 15K context). It now uses `runs.context_used`, the last context size the agent reported.

#### The switching rule (built)

`orchestration/cache-switch.ts`, used by the route score:

- **The switching penalty** is the extra cost of the first call on a new model: the session's context (`runs.context_used`) re-read at the new model's cache-write price, minus the same context read on the session's model, at its cache-read price while the cache is warm (last used within 5 minutes) and at its write price once cold. It grows with the context: about $0.10 at 20K, $0.23 at 48K and $1.92 at 400K for Sonnet 5 → Opus 5.5 while warm.
- **Prefer the warm session.** With a resumable task session on the chat's provider, the session's model is the anchor. The route never steps below it, and steps up only when the stronger model's score, with the penalty added to its cost, beats the session model's. The why line says either "kept Sonnet 5: warm session, 48K context" or "complex → top tier (migration); left the warm Sonnet 5 session (48K context)".
- **Never mid-loop.** Fix turns, continues and Critic fix rounds reuse the stored route, as before. The one exception stays the escalation after a failure or an "unsupported" verdict, which acts on evidence that the model fell short.
- **Absolute.** A pin, destructive work (top tier), the user asking for the top model and the model floor bypass the score; a session below the floor is never resumed for a Builder.

#### Task signals (built)

- **Jev ratings.** The Do intake adds four Score questions to the same batched call, each with five levels written as situations (`advisor/rating-questions.ts`): `complexity`, `ambiguity`, `stakes`, `context_dependence`. No new state is sent. The category is the existing `intent` Choice. The four questions add about 400 input tokens (1,685 characters); a whole intake call on the live corpus was about 2,300 tokens, $0.0001.
- **Rule estimates** (`orchestration/task-signals.ts`) stand in when Jev is off, fails, or answers below `RATING_ACT_AT` (0.5): complexity 1 for a trivial edit, 4 for complex work by rule, scan or Jev's top tier, else 2; stakes 5 destructive, 4 migration or security, 1 trivial, else 2; ambiguity 3 when the request is vague, else 2; context 4 for a follow-up in the same task, else 2.
- **Rules first.** Jev can raise a fired complex or high-stakes rule but never clear it, and it overrides a fired trivial rule only at 3 or more (`TRIVIAL_OVERRIDE_AT`).

#### The route score (built)

`orchestration/route-score.ts`, called from `routeBuilder` for Builders on Auto:

- **Candidates:** the chat provider's models at or above the floor tier and not retiring (never frontier unless it is the chat model), plus the chat model and the session model. Frontier stays off the automatic ladder.
- **Expected quality** `q = 1 − failure`: a failure rate per card tier and complexity level (`ROUTE_FAILURE`), raised by 25% per level of ambiguity and of context dependence above 2, and never below the Wilson lower bound of the model's measured Builder failures when it has 10 or more runs (`model_stats`, `measured-seed.json`).
- **Cost:** the whole task's tokens by complexity (`ROUTE_TRAJECTORY_MTOK`, 52K–650K) priced at the card's blend of 85% cached reads, 12% cache writes and 3% output (the mix of the dev-history Builder runs), plus the switching penalty.
- **Utility, in dollars** (since the escalation routes): `−(token cost + switch cost + (1 − q) × repair)`, the expected cost of the route including the developer's repair when it fails. The repair cost is $10 (the routing-live estimate: a top-tier rerun plus 10 minutes of the developer's time) × a stakes weight (0.5, 1, 1.5, 3, 10) × a size weight (0.25, 1, 1.5, 2, 3). It is the old `q − cost / repair` multiplied by the repair cost, so it ranks every candidate exactly as before (replay: 267/267 rules only and 267/267 with Jev ratings against the previous code); the difficulty discount Cloudflare applies falls out of the repair cost growing with stakes and complexity.
- **Pick:** the ranked list's best model that is allowed: at or above the anchor's tier, or, with no session, below it only when its quality is within 0.0002 of the anchor's (adequate). Ties keep the anchor. The rest of the list is the fallback order.
- **Legible.** The route decision stores `signals`, `repairUsd` and the top three `scores` (quality, cost, switch cost, expected cost, utility), and the why line adds "score complexity 2, ambiguity 2, stakes 2, context 2; repair $10.00; expected cost incl. repair: Sonnet 5 $0.11 (q 0.996, $0.07 tokens), Opus 5.5 $0.16 (q 0.996, $0.12 tokens)" (a rating Jev supplied is marked "(Jev)"). The rule names stay: "chat model", "trivial → middle tier", "complex → top tier (…)", "kept model to resume session", plus "score → top tier (…)" and "simple → mid tier (…)" for moves the ratings made.

#### Escalation routes for a hard follow-up (built September 30, policy `route-score-2-escalation-routes`)

The research behind this (the September 30 escalation study: Anthropic's caching docs and prices, Chroma's context-rot study, the multi-turn "lost in conversation" paper, SWE-Router, Scrouting, TwinRouterBench, Cloudflare's Auto Router): with Opus 5.5 and Sonnet 5 sharing a $0.20 cache-read price, escalating costs one context-sized re-read ($1.92 at 400K), long transcripts hurt a mid-tier model most, and a clean restatement helps any model. So a hard follow-up deep in a session should go to the stronger model through a handoff, not stay on the cheaper model and not re-read the whole transcript cold.

`orchestration/escalation.ts` picks one of five routes whenever a follow-up resumes a task session (a Builder on Auto with a resumable session on the chat's provider; pins, destructive work, an explicit ask for the top model and the floor bypass it, as before):

| Follow-up                                                     | Context | Context dependence                 | Route                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hard: complexity or stakes ≥ 4 (`ESCALATE_AT`)                | < 100K  | any                                | **switch**: the session moves to the stronger model and re-reads its context, when the dollar score says so (as before)                                                                        |
| hard                                                          | ≥ 100K  | ≤ 3                                | **brief**: a stronger Builder in its own session (`${taskId}:escalated`) with a structured brief; the cheaper session stays warm                                                               |
| hard                                                          | ≥ 100K  | ≥ 4 (`COMPACT_CONTEXT_DEPENDENCE`) | **compact**: the same handoff, more recent turns verbatim, opens a fresh session on the stronger model under the task's Builder key                                                            |
| complexity 3 (`RAISE_EFFORT_AT`), the score keeps the session | any     | any                                | **effort**: raise effort one step on the warm session, only when the card says an effort change keeps the cache (`reasoning.effortKeepsCache`: Opus 5.5; Sonnet 5 is not flagged, so it stays) |
| everything else                                               | any     | any                                | **stay** warm                                                                                                                                                                                  |

- **The score still decides.** The handoff routes replace the switching penalty with a handoff of `HANDOFF_TOKENS` (25K) at the stronger model's cache-write price; the stronger model is taken only when its expected cost incl. repair beats the warm session's. At 180K a complexity-4 follow-up moves (Opus: about $0.56 of tokens incl. a $0.13 handoff against a $0.50 lower repair risk at a $20 repair cost), while a stakes-4, complexity-2 follow-up stays on Sonnet (the tier gap at complexity 2 is 0.05%).
- **The brief** (`orchestration/handoff.ts`, the coordinator's piece-brief shape): goal (the request), rules (the repository's instructions are loaded into every fresh session by the launch; plus the increment, ship and git rules), the agreed plan, decisions so far (the last 6 turns, 1,500 characters each; compact keeps 12 at 4,000 as "Recent turns, verbatim"), relevant files (the task's changed files and files named in the request), the current diff against HEAD (24K characters), open issues (the task's latest failing checks and open review findings) and acceptance. Stale tool output never enters it: Spark keeps only compact replies in the chat.
- **Handback.** After a brief, the next routine follow-up resumes the cheaper session with a note that the stronger Builder handled the last request, and its reply.
- **No ping-pong.** After a switch or compact the task never steps back below the stronger tier, even once the session expired ("stayed on Opus 5.5: escalated earlier in this task"); a session never steps below its own model anyway. After a brief, later hard follow-ups go back to the stronger Builder ("… Builder with brief again") and routine ones to the warm cheaper session. The escalation is stored on the child run's `route.escalation`.
- **Penalty inputs.** A cold incumbent (last call more than 5 minutes ago) is charged only the write-price difference (`switchCostUsd`, unchanged). Every switch and handoff adds the incumbent's reasoning tokens from its last run (`runs.thought_tokens`, capped at `LOST_REASONING_CAP_TOKENS`, 32K) at the new model's output price.
- **Critic.** An escalated result (switch, brief or compact) with stakes ≥ 4 always gets the Critic, which runs on the other provider when one is connected (`critic-rule.ts`, `escalatedHighStakes`). The existing rule already covered destructive work and migrations, not Jev's stakes ≥ 4.
- **Effort and sessions.** A keyed (child) session on a model whose card sets `effortKeepsCache` hashes its settings without effort, so raising effort resumes it; ACP applies the new effort with `set_config_option`. Chat sessions still start fresh on any effort change.
- **Legible.** The rule names the route: "hard follow-up at 180K → Opus 5.5 Builder with brief; Sonnet 5 session kept warm", "hard follow-up at 180K → compacted handoff; session moves to Opus 5.5", and for effort "kept Opus 5.5: warm session, 180K context; effort medium → high (the cache survives an effort change)". The route decision stores `escalation`: the route, whether it was hard or sticky, the context, whether the cache was warm, the session's pick, the target, and the full-switch and handoff costs.
- **Provisional.** Every threshold above is a named constant in `advisor/policy.ts` and a first guess from the report's cost table, not a fit.
- **Measurement hook.** `scripts/routing/escalation-scenarios.ts` defines three hard follow-ups at 220K–400K for the four arms (stay warm, cold full switch, compact then switch, stronger Builder with brief); `RouteFacts.arm` forces an arm. `pnpm routing:escalation` is a dry run: each arm's route, first-call extra cost ($1.06–1.92 for a cold full switch, $0.13 for a handoff), token cost, prior pass rate and expected cost incl. repair, plus the rendered handoff size (about 3.6K tokens on the fake data). The arms run end to end against the fake ACP agent in `test/escalation-routes.db.test.ts`. **Pass-rate evidence is pending:** no live run has compared the arms; a live run needs the story or dev-day harness to pass `arm` through, and anything that lowers the pass rate is reverted.

#### Calibration

The constants are in `advisor/policy.ts` and were fitted so that current benchmark picks don't change:

- **Evidence:** Sonnet 5 passed 32/32 live Builder runs and Opus 5.5 6/6 with no extra passes; Haiku 4.5 failed 4/22 silently ([routing-live-2026-09-27.md](../benchmarks/routing-live-2026-09-27.md)). So complexity 1–3 carries almost no gap between mid and top (0.3%, 0.45%/0.4%, 0.8%/0.7%), complexity 4–5 carries the gap the "complex → top tier" rule already assumes (4%/1.5%, 10%/4%), and small is 5–45%. The mid-versus-top numbers above complexity 3 are priors, not measurements.
- **Replay** (`pnpm routing:replay`, `scripts/routing/replay.ts`): 89 recorded requests (the code-scan corpus, the bench tasks, the e2e scenarios and the dev-day sessions) × 3 chats (Sonnet 5, Opus 5.5, 6 Sol) = 267 Builder routes, old code against new.
  - **Rules only (Jev off): 267/267 identical picks and rule texts.**
  - **With live Jev ratings** (`pnpm routing:ratings`: 89 calls, 208K input tokens, $0.0087): the first calibration agreed on 245/267 (91.8%). 16 moved Sonnet → Opus, mostly because Jev rates any task touching amounts "stakes 4" (the level names money) and the ledger scenarios are all money parsing, where Sonnet had passed every run. Lowering the mid failure rate at complexity 2–3, putting the stakes weight for 4 at 3 and for 5 at 10, and keeping trivial edits trivial unless Jev rates them 3 or more gave **263/267 (98.5%)**. The four changes: two cross-library renames the trivial rule caught ("Rename routeBuilder to pickBuilderRoute everywhere", "Rename the KpiCard component … across all libs") stay on an Opus chat's own model instead of dropping to Sonnet; one complexity-4 TypeScript compiler change moves a Sonnet chat's Builder to Opus; a Do-mode question (answered in place, so the Builder route is unused) scores Sonnet on an Opus chat.
  - **Jev's ratings:** complexity was confident (median confidence 0.85, 81/89 at 0.5 or more), stakes 0.64 (74/89), ambiguity 0.56 (61/89), context 0.54 (55/89). Stakes skews high: 47/89 at 3 and 14/89 at 4.
- **Still to measure:** no live Builder run has used the score yet. Before trusting a rating-driven move up or down, compare the moved classes on pass rate and cost per success including repair (Rollout step 3); ROUTING_PLAN §4 still applies: anything that lowers the pass rate is reverted.

## Rollout

0. **Prototype and load-test the scan.** Build the indexer and the per-task scan. Measure on a small repo, `feature-web-apps` (5,443 files, 133 Nx projects) and a 100,000-file repo: first index time, per-task scan time, cache size, and API response time while five projects scan at once. Continue only if per-task scans stay under 2 s and the API stays responsive.
1. **Shadow.** Build steps 1–3 and log Jev's route next to the rule's route, as `autoWouldUse` does today. No behaviour change.
2. **Label.** Collect about 50 real tasks with outcomes, plus a seeded corpus of coding tasks with preferred tiers (pi's 24-task file is a template).
3. **Compare.** Rules vs Jev text-only vs Jev with evidence, on pass rate first, then preferred tier, escalations, Keep rate and cost per successful task. The evidence only ships if it beats text-only.

   **Cost is not the whole picture.** A cheaper route that fails pushes the cost onto the user: noticing, re-prompting, debugging and fixing, plus lost trust. Compare on cost per successful task including an estimate of that repair cost, never on spend alone. A small tier only takes over a class of tasks when it passes them as reliably as the tier it replaces.

4. **Switch.** Jev routes; the verified cascade replaces retry-up.
5. **Delete.** Remove `TRIVIAL_VERB`, `trivialByRule` and the trivial branch of `routeBuilder`. Keep `DESTRUCTIVE` as a safety gate.

## Open questions

- Does codebase evidence improve the route, or only raise the input tokens? (Step 3 answers it.)
- Do `tree-sitter-wasms` grammars load in the `@vscode/tree-sitter-wasm` runtime? (The prototype checks.)
- Is the per-file size estimate right? The prototype measures it.
- Should the verifier be Jev alone, or Jev plus the Critic for large diffs?
- May `feature-web-apps` metadata (paths, symbol names, task text) be sent to Jev? (Section 11.)

Decided since the first draft: the grammar package (section 2), effort from the provider default (section 1), user-driven provider switches with a handoff (section 9), running without Jev (section 8), keeping Postgres for the desktop app (section 10), and decomposition by the coordinator (section 7).
