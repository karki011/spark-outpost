# Project Map

The Project Map is a background, read-mostly model of each linked repository: every indexed file,
its resolved imports, the areas the files group into, how important each file is, stable 2D
positions for a "sky" of areas and the files inside them, Jev labels per area, and links between
repositories (a front end calling a back end, shared packages, shared env keys). The Map page in
the web app draws it (see [The UI page](#the-ui-page)).

## Where it runs

- The builder runs in the **worker process** (`apps/server/src/workflow/main.ts` starts
  `startMapScheduler`), never in the API process. The API only reads map tables and writes
  category overrides.
- One repository at a time. The scheduler syncs `map_repos` with `projects.root_path` (one map per
  repo root, so two projects on the same folder share a map), builds queued or unfinished maps
  first, then checks ready maps for changes at most once a minute.
- **Low priority.** Every step goes through a gate (`map/pace.ts`) that yields to the event loop,
  keeps busy time within a CPU budget (`CPU_BUDGET = 0.3`: after 40 ms of work it sleeps long
  enough to keep the duty cycle at 30%), and **pauses while any agent run is queued or running**
  (status `paused`, rechecked every `MAP_POLL_MS`). The index phase shares the code scanner's
  lane, so a map build never indexes a repo at the same time as a run's scan.
- **Resumable.** The build records its phase (`index → graph → labels → links → done`) before
  starting it. After a crash or shutdown the next worker resumes from that phase; finished labels
  and link pairs are kept and not asked again.
- **Incremental.** A repo's signature is its `HEAD` plus the size and mtime of every file
  `git status` reports. When it changes (a commit, a run's edits), the map is queued again. The
  code index then re-parses only changed files (the existing refresh plan), the graph is
  recomputed from the index in memory, unchanged files keep their positions, and Jev is asked
  only about areas whose important files changed.
- Git access is read-only (`ls-files`, `log`, `rev-parse`, `diff` between commits,
  `status --no-optional-locks`).

## Pipeline

1. **Index** (`codescan/`). The existing tree-sitter parse now also records import specifiers
   (TS/JS static, re-export, dynamic `import()` and `require`; Python `import`/`from`; Go
   `import`) and **endpoints** (`codescan/endpoints.ts`, `codescan/api-specs.ts`): HTTP routes
   (Express/Koa/Fastify/Hono style, NestJS decorators, Next.js `pages/api` and `app/**/route.ts`,
   FastAPI/Flask/Django, Go net/http, gin/echo/chi, Spring), mounts and prefixes (`app.use('/api',
…)`, routers with `prefix`, Go groups, OpenAPI `basePath`), client calls (`fetch`, axios/ky/…,
   `useSWR`, API wrappers, template and base-URL calls, Python `requests`/`httpx`, Go `http.Get`),
   OpenAPI/Swagger routes, GraphQL schema fields and operations, and env keys. The parser version
   moved to `…+imports@1`, which rebuilds every index once.
2. **Graph** (`map/resolve.ts`, `map/resolver-config.ts`, `map/graph.ts`). Imports resolve
   against the indexed file set: relative paths with extension, `index` and `.js → .ts` probing;
   tsconfig/jsconfig `paths` and `baseUrl` (JSONC, relative `extends`); workspace packages by
   name via `exports`/`main`/`module`/`types`, mapping build folders (`dist/`, `lib/`) back to
   `src/`; Python modules from the repo root, `src/` and each Python project folder; Go packages
   under the module path from `go.mod`. Unresolved imports are external and ignored. Each file
   gets fan-in and fan-out.
3. **Areas** (`map/areas.ts`). Deterministic and explainable: every file starts in its workspace
   package, else its top-level folder, else "(root)". An area with more than 120 files splits by
   its next folder level (up to 6 levels). Split-off folders with fewer than 4 files merge into
   the sibling area in the same package or top folder they share most import links with
   (then nearest folder, then name). Each area carries a `reason` ("folder apps/server/src/api,
   split from apps/server (…)"; "merged … (2 files, 3 import links)"). The area id is a hash of
   its root folder, so it is stable across runs and survives files coming and going.
4. **Importance** (`map/importance.ts`). Per file, 0–1: 35% fan-in (log scaled), 20% churn and
   10% distinct authors (last 500 commits; author emails are stored only as short hashes), 10%
   CODEOWNERS, 15% path patterns (auth, migrations, schema, design system, CI, payments, entry
   points, build config), 10% age within the history window. Tests count half. Every score comes
   with reasons ("imported by 34", "auth", "changed 12 times", "code owners"). Each file also keeps
   its last change date, change count and distinct author count from the same history (counts
   only; author emails stay hashed and are never stored on the map), and a **kind** (`ui`, `api`,
   `data`, `test`, `config`, `other`, `map/file-kind.ts`): test paths first, then files that
   define routes or mounts, then path patterns, then imports (UI libraries, database clients,
   server frameworks) and backend folders or languages. Areas store per-kind file counts so the
   page can show kind totals without loading every area.
5. **Layout** (`map/layout.ts`). Seeded force layout (positions derived from path hashes), run in
   the worker between yields: files inside each area in area-local coordinates, then areas as a
   sky with radii from their content. Areas with more than 400 files use a golden-angle spiral
   ordered by importance. On refresh, files and areas that already have a position are pinned;
   only new nodes move (placed near their neighbours); an area whose radius changed by more than
   15% is re-placed.
6. **Labels** (`map/labeller.ts`, `map/label-questions.ts`, `map/label-evidence.ts`). Rules
   give every area a fallback kind and category (`map/rules.ts`). When Jev is connected, one
   System One call per area asks three choice questions: **category** (Core, Shared, Feature),
   **kind** (ui, api, data, domain, auth, integration, infra, tooling, config, tests, docs) and a
   **name** chosen from readable candidates (folder, parent folder, package, key files). Jev
   answers only choices and scores, so the description is written from facts ("UI code in
   apps/web/src/chat: 42 files, … Key files: …"). Answers are applied at confidence ≥ 0.8
   (`MAP_ACT_AT`), otherwise rules stand and the label is marked `rules` with Jev's confidence.
   The evidence holds the area's facts, up to 120 paths by importance and the contents of the most
   important files within 6,000 tokens (≤1,500 per file), wrapped in the untrusted
   `<code_evidence>` block. **Secret files are never sent**: paths matching the shared secret list
   or `.sparkignore` (`isSecretPath`), skipped and binary files are dropped from both the path list
   and the contents, and every file goes through `redactText` (which now also catches Stripe
   `sk_/rk_/pk_live|test_` and Google `AIza` keys). Each call is recorded in `map_jev_calls`
   (status, model, tokens, cost, latency, policy version, redacted request, answer and which
   files' contents were included). Areas are relabelled only when the rules version or label
   policy changes, when Jev becomes available for a rules-only label, or when fewer than 60% of
   the area's 30 most important files are the ones it was labelled with. At most 300 areas per
   build go to Jev.
7. **Links** (`map/link-match.ts`, `map/links.ts`). After a repo builds, links are recomputed
   for every pair it forms with another built map whose pair signature (both sides' source
   signatures plus `MAP_LINK_POLICY`) changed:
   - **http**: each client call is matched to routes of the other repo. Paths are normalised
     (`:id`, `{id}`, `<int:id>`, `[id]`, `${…}` all become parameters). A route matches when the
     call ends with it and the remaining prefix is empty (0.95), a known mount of that repo (0.9),
     or unknown behind a base URL (`${API}/…`, 0.8/0.7). Method mismatches never match; unknown
     methods cost 10%; a dynamic call segment against a literal route segment costs 40%. The best
     fit wins, more literal segments break ties; true ties become an ambiguous call whose
     candidates share the confidence.
   - Ambiguous calls (at most 40 per pair) go to Jev with the redacted code around the call
     (never from secret files) and the candidate routes plus "none"; an answer at ≥ 0.8 keeps
     only the chosen link (`source: jev`).
   - **graphql**: operations' root fields to schema fields (0.9).
   - **package**: both repos import a package that one of them defines (0.85) or one in the same
     npm scope as a package they define (0.6); one link per area pair, between the most
     important importing files.
   - **env**: the same env key used on both sides after dropping public prefixes (`VITE_`,
     `NEXT_PUBLIC_`, `REACT_APP_`, …), excluding generic keys (0.4).

## Storage (migrations 0072, 0075, 0078)

- `code_index_files.imports text[]`, `code_index_files.endpoints jsonb`.
- `map_repos`: one row per repo root: status (`queued`, `building`, `paused`, `ready`,
  `failed`), phase and progress, `rules_version` (`MAP_RULES_VERSION`), source and built
  signatures, built commit, counts, per-phase timings and Jev totals, error.
- `map_areas`, `map_files`, `map_edges`, `map_area_edges`: the current model and positions,
  replaced in one transaction per build (readers never see half a map).
- 0075 adds `map_files.kind`, `last_changed_at`, `change_count`, `author_count` and
  `map_areas.kind_counts`; `MAP_RULES_VERSION` moved to `map-rules-2` so every map rebuilds once
  (labels are kept).
- 0078 adds `map_repos.jev_areas`: how many areas this build sends to Jev (`0` when Jev is not
  connected, `NULL` until the labels phase starts; reset when a build is queued). The status
  exposes it as `jevAreas` so the app says "Jev is labelling" only while Jev is really asked.
  The index phase now reports files read against files to read.
- `map_labels`: per area label, source, confidence, the basis files and policy version.
- `map_overrides`: user category overrides keyed by **root path and area id**, not by map row,
  so they survive rebuilds, rules changes and even removing and re-adding the project. Overrides
  always win when the API merges labels.
- `map_jev_calls`: audit of every map Jev call.
- `map_link_pairs`, `map_links`: links per unordered repo pair, stored apart from either map.

Reset empties all of these (it truncates every table it finds in `information_schema`).

## API

- `GET /api/projects/:id/map` → build status (with `mapId`, phase, progress, timings), areas
  (name, description, category and its source `override | jev | rules`, kind, confidence,
  counts, fan-in/out, importance, top files, `x`, `y`, `radius`) and weighted area edges. Level
  of detail: no files here.
- `GET /api/projects/:id/map/areas/:areaId?offset=&limit=` → the area plus its files by
  importance (area-local `x`, `y`, reasons) and import edges touching them, paginated (limit
  ≤ 500, `nextOffset`).
- `GET /api/projects/:id/map/neighbors?path=&hops=1|2` → the files a file imports and the files
  importing it within the hops (each with area, kind, importance, fan-in and hop; at most
  `MAP_NEIGHBORS_MAX` (200) per side, with totals) and `impact`: direct dependents, all transitive
  dependents (recursive over `map_edges`), how many areas they sit in, and the Core areas among
  them. 404 when the file is not on the map. Areas also report `lastChangedAt`.
- `PUT /api/projects/:id/map/areas/:areaId/category` with `{ "category": "core" | "shared" |
"feature" | null }` sets or clears the override.
- `GET /api/map/links?projects=<id>,<id>[,…]` (2–8 projects) → the maps' status, file-level links
  (kind, label, both paths and areas, lines, confidence, source) and aggregated area links.

- `GET /api/map/unmatched?projects=<id>,<id>[,…]` (2–8 projects) → `routes` nothing calls and
  `calls` that reach no route (`projectId`, `method`, `path`, `file`, `line`, `confirmedBy`),
  each capped at `MAP_UNMATCHED_MAX` (200, most important files first) with `routeTotal` and
  `callTotal`, and `pending: true` while any selected map is not `ready` or a repo pair's links
  are missing or stale (the page hides the Unmatched chip until then). A route counts as called when a stored `http` link reaches it or a call in its own
  repo matches it; a call is matched the same way. Test files are ignored, and routes without a
  literal segment (`/`, `/:id`) are never listed. `confirmedBy` is always `null` for now: every
  route is "Possibly unused" until Jev can confirm.
- `GET /api/tasks/:id/changes` also returns `core`: the Core areas (effective category after
  overrides) and key files (top 2% by importance) the task's non-reverted changes touch, or
  `null`. It only highlights; approvals are unchanged. Ship adds the same facts as a
  "Core impact" section to the PR description.

Live updates: the worker sends `{ kind: 'map', mapId }` on the existing `changes` channel when a
build starts a phase, every 500 ms of progress, on pause and resume, and when it finishes, so the
app event stream can refresh a map as its constellations appear.

## Measured

`scripts/map-bench.ts` builds maps in a scratch schema of the test database and reports wall
time, process CPU, peak RSS and phase timings (`--repo name=/path`, `--budget`, `--jev`,
`--touch name=path` for an incremental commit in a scratch clone).

Intel Mac, 2026-09-30:

| Repo                             | Files / areas / edges | Full build                       | CPU budget     | Unchanged rebuild | One-file commit | Peak RSS |
| -------------------------------- | --------------------- | -------------------------------- | -------------- | ----------------- | --------------- | -------- |
| Spark Outpost (clone)            | 1,930 / 86 / 5,710    | 26 s (index 22.7 s, graph 2.8 s) | 1.0 → 0.81 CPU | 1.7 s             | 2.0 s           | 752 MB   |
| Spark Outpost (clone)            | same                  | 62 s                             | 0.3 → 0.30 CPU | 3.3 s             | 3.6 s           | 681 MB   |
| feature-web-apps (nx, read-only) | 5,487 / 268 / 12,642  | 93 s incl. 268 Jev calls (61 s)  | 1.0 → 0.37 CPU | 3.9 s             | n/a             | 782 MB   |

The first full index dominates time and memory (tree-sitter parse worker); later refreshes stay
under ~300 MB. Jev labelling: 86 areas cost $0.026 (630k input tokens, ~7.3k per area, ~230 ms
each); 268 areas cost $0.079 (1.89M tokens).

## The UI page

The Map item in the rail opens `MapPage` (`apps/web/src/map/`, wired in `apps/web/src/app/App.tsx`).
It has:

- a view switcher (Tree · Focus · Outline · Sky; the last view is remembered per viewer in
  `localStorage`, `map-views.ts`) with search, filters by category and file kind, and a first-time
  tip per view (`ViewTip.tsx`, dismissals remembered per viewer);
- **Tree** (the default, `tree/`): areas grouped by their top-level package or folder
  (`groups.ts`: the folder trie is split largest group first, aiming for about 24 groups and never
  more than 36; a split only happens when it yields at most 8 parts, unless there are fewer than 4
  groups; parts under 0.5% of the files merge into one "Other in …" group for their parent). Each
  group card shows its Core/Shared/Feature badge (the label source and confidence on hover), file
  count, importance bar, kind mix and files changed in this chat; edges are area imports summed per
  pair (Strong keeps about 1.2 edges per node per container, More 3, All everything). A group opens
  into its areas (24 at a time), an area into folders below the files' shared prefix (when it has
  more than 12 files) and files (24 at a time, loaded through the paginated area API). Layout is
  dagre left to right on each container's two strongest outgoing edges per node, run in a Web Worker
  (`tree-layout.ts`, `tree-layout-worker.ts`); tall ranks wrap into columns of six and very wide
  chains fold into a grid. Drawn with React Flow (`@xyflow/react`, only visible nodes rendered,
  minimap, zoom, compact cards when zoomed far out). Arrow keys move between cards, Enter opens,
  Escape closes, F focuses a file; search opens the path to a file and centres it. Two projects sit
  in two columns (callers first) with dashed link edges. React Flow and dagre load with the map
  chunk only (the Map page and the tree are lazy chunks);
- **Focus** (`focus/`): one file's imports on the left and importers on the right, 1 or 2 hops,
  grouped by area with Core first, and "What breaks if I change this?" (direct and transitive
  dependents, areas and Core areas affected) from `GET /api/projects/:id/map/neighbors`;
- **Outline** (`outline/`): a virtualized tree list of groups, areas and files sortable by
  importance, name, size or most recent change, and the phone default;
- the **Sky** drawn on a canvas (`SkyView.tsx`, `SkyCanvas.tsx`, `engine.ts`) as an optional
  overview;
- a repo picker and cross-repo links (`bridges.ts`: http, graphql, package, env), with link,
  path and unmatched-endpoint panels (`CombinedPanels.tsx`);
- build status: a toolbar pill with the current stage and overall progress
  (`MapStatusPill.tsx`) and, on a first build, a card with one blob per stage (Reader, Tracer,
  Jev, Linker in combined maps), a segmented bar and a rough time left (`build-stages.ts`,
  `BuildStages.tsx`); "paused while agents run" puts every blob to sleep;
- an empty state that explains the map and adds a project through the folder dialog, and a
  retry state when the projects list cannot be loaded (`MapEmpty.tsx`, `SkyDoodle.tsx`);
- an area review with the per-area category override (`ReviewAreas.tsx`, `use-area-review.ts`);
- a file detail sheet that can open the file in a chat, and highlights for files changed in the
  latest chat and their dependents (`FileDetailSheet.tsx`, `use-chat-changes.ts`,
  `CoreImpactNote.tsx`).
