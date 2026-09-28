# Routing plan

> **Status: rollout step 1 (shadow) built on September 27, 2026.** The code scan (step 0), the Jev file ranking and the route question run for every Do task and are recorded next to the rule route (`run_advice` purposes `scan`, `rank` and `route_shadow`; the `routing_labels` view; `pnpm routing:labels`). The Builder still runs on the rules in `orchestration/routing.ts` and `risk-rules.ts`. Results: [routing-shadow-2026-09-27.md](../benchmarks/routing-shadow-2026-09-27.md). **Since September 28 the Builder has a floor (policy `floor-1`):** it never runs on the small tier, and it gets the top tier only for complex work (section 4). Evidence: [routing-live-2026-09-27.md](../benchmarks/routing-live-2026-09-27.md). **Since September 28 (policy `fixturn-3-devday-rerun-nohaiku`) the harness never picks the fast tier or a retiring model for any role** (section 4, "Harness floor"): Haiku 4.5 retires on October 15, 2026.

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
- **Complex work → the top tier** (`orchestration/builder-complexity.ts`). The user asks for the top model; the request is a migration, security work or spans several packages; the code scan (only if already finished) matches 15+ files or 3+ packages and the request is broad (broad wording, several parts, or Jev's complexity or top tier), unless it is a one-line fix or Jev's small tier is at 0.8 or more (`complexByBreadth`); or Jev's intake tier is top at 0.8 or more. The rule reads "complex → top tier (reason)", and a task session on another tier is not resumed for it. Otherwise the middle tier: Opus bought no extra passes in the live round, and Jev's Opus picks there were all at 0.62 or less.
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

Only large, spread-out tasks (many ranked files in unrelated areas) get a planner and per-subtask routes. Not in the first cut.

### 8. Without Jev

Jev is optional: no key, the user turned it off, or the service is down. The harness still works:

- **The Builder subagent still runs,** one per Do task, with a worktree when the repo is busy.
- **The model is the one the chat picked,** at the provider's default effort. The code policy still applies: a pin, destructive work → the top tier, the Builder floor and complex work → the top tier (by rule and scan), the cost cap.
- **The code scan still runs** (it's local), and its evidence still goes to the Builder as a starting file list.
- **No cascade, only checks:** checks run with up to 2 fix turns, and there is no rerun one tier up. There's no diff verdict, so a passing check is trusted.
- **No intake questions:** vague requests aren't caught, and there's no injection check beyond the approval rules.

We don't add a second LLM classifier as a fallback (pi has one). It would cost a model call per task and needs its own evaluation; the chat's model is a sound default.

### 9. Switching provider mid-task

A provider switch doesn't have to lose the conversation, but it does lose the prompt cache. The cache lives on the provider's servers, so the new provider has to read the context once at full price. After that, it caches as usual.

- **The user can switch any time.** The new session gets a handoff: the task, the plan so far, the files changed, the last check results and the recent turns (the digest already builds most of this), not the whole transcript. That keeps the one uncached read small.
- **The router never switches provider on its own inside a task.** The escalation stays on the same provider; the Critic already uses the other provider in its own session.
- **Same provider, different model:** also a new session in ACP today, so it pays the same one-time read.

### 10. Desktop app (Electron) and the database

The goal is an Electron app. The plan works there because Electron is also several processes:

| Today                          | In Electron                         |
| ------------------------------ | ----------------------------------- |
| Browser tab (UI)               | Renderer process, same React app    |
| API server                     | Separate process (`utilityProcess`) |
| Workflow worker (scan, agents) | Separate process                    |

The rule: **no server work in Electron's main process.** It drives the windows, menus and shortcuts, so blocking it freezes the app. ripgrep's binary must be unpacked from the app archive (`asarUnpack`) and built per CPU type, as VS Code does. `web-tree-sitter` is WebAssembly and needs no rebuild. `git` is detected at startup.

**Database decision (recommended now): keep Postgres and bundle it.** The server depends on Postgres features: `LISTEN/NOTIFY` for live updates between the API and the worker (`persistence/*`, `api/app-events.ts`), `FOR UPDATE SKIP LOCKED` for the job queue (`persistence/jobs.ts`), and every migration.

| Option                                                                                                                                                                           | Verdict                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real Postgres, bundled** ([`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres), which ships per-platform Postgres binaries and runs them as a child process) | **Recommended.** No code changes; the API and worker keep separate connections. The npm package's current release is a beta, so pin a version, or ship the same binaries ourselves. About 30–40 MB added per platform. |
| PGlite (Postgres compiled to WebAssembly)                                                                                                                                        | Same SQL, but one connection per database instance. Our API and worker are separate processes, so one would have to own the database and serve the other. Not proven for us.                                           |
| SQLite                                                                                                                                                                           | Rewrite every migration, the live-update channel and the job queue. Too much for no user benefit.                                                                                                                      |

Deciding now means the scan cache and everything else keep using Postgres without second-guessing. The packaging work itself waits until the app is ready to ship.

### 11. First test repo: `Cloudzero/feature-web-apps`

Cloned (read-only use) into the session scratchpad at `scratchpad/repos/feature-web-apps`. It's an internal company repository. The profile:

- 5,443 tracked files, 1,736 commits, 83 MB of git history;
- TypeScript almost entirely: 2,513 `.ts`, 1,799 `.tsx`, plus JSON, Markdown, YAML and a little Python and shell;
- an Nx + pnpm monorepo: 133 `project.json` projects under `libs/ui` (2,552 files), `libs/features` (1,264), `libs/foundations` (720) and `apps/web` (405);
- it has `CLAUDE.md`, `AGENTS.md` and `.claude/agents`;
- a warm ripgrep search for one identifier across the whole repo took 0.16 s (130 matching files).

It's a good test of the monorepo signals: one request can touch one Nx project or many. "Training" here means building a labelled task set and tuning our wording and thresholds; nothing trains Jev itself.

**Privacy:** the local scan never leaves the machine. Jev is an external service (TypeSafe), and its state includes this repo's file paths, symbol names and the task text. The user confirmed on 2026-09-27 that the company allows this for `feature-web-apps`. Other company repositories need their own confirmation.

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

Decided since the first draft: the grammar package (section 2), effort from the provider default (section 1), user-driven provider switches with a handoff (section 9), running without Jev (section 8), and keeping Postgres for the desktop app (section 10).
