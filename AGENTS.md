# AGENTS.md — Spark Outpost

Instructions for humans and coding agents working in Spark Outpost.

## Product and stack

- Build a local-first, provider-agnostic workflow application. Cloud hosting is a future direction, not a reason to add unused infrastructure today.
- Use a pnpm workspace monorepo, TypeScript, React with Vite, and Node.js with Express.
- Use local PostgreSQL with versioned schema migrations. Keep database access in the backend.
- The local web interface comes first. Electron (`apps/desktop`) is the desktop shell; it stays a thin wrapper around the unchanged web app and Node service. A Rust backend is not required.
- Use React state for UI interactions, TanStack Query for cached API data, and AG-UI events for live run updates. Give each piece of state one clear owner.
- Coding agents connect through ACP. CopilotKit is not used; if evaluated later, verify the exact integration license and do not introduce a paid runtime requirement implicitly.
- The harness owns workflow state, execution policy, budgets, cancellation, recovery, and verification. Jev is an optional decision service; providers execute through explicit adapters.
- Use A2A where independent agent communication is needed. Do not wrap every internal function or worker in a protocol without a current need.
- Agents operate within authorized boundaries. Approval checkpoints are enforced by the backend; model recommendations cannot grant authority.
- Agent permissions come from the provider: users pick one of the modes the agent's session advertises (for example Claude Manual, Accept edits, Plan, Auto, Bypass permissions; Codex Read-only, Ask every time, Approve for me, Full access), shown with the agent's own names; stored as `agentMode`, with `permission` derived (read-only modes are Ask runs). Separately, Spark autonomy (set in the chat's Work panel, shown as a chip in the context bar) decides only what happens to the result: Automatic (default; keeps changes without stopping) and Full auto → PR (the same, then opens a PR), stored as `level`: `hands-off`, `full-auto`. Reviewing each step is the agent mode's job (for example Manual or Plan). Use these names in user-facing text; never say "harness" to users. The safety floor (secret files and agent instruction files always ask, git hooks and git config ask with hold-to-confirm, no force pushes, no pushes of any branch but the chat's own spark/* branch, no remote changes, no writes outside linked repos, audit, budgets) holds in every mode; an agent, Builders included, may push the chat's own spark/* branch and run `gh pr create`/`view`/`edit` only when the user's message asks for it, the chat is at Full auto → PR, or its mode is Auto/Bypass permissions (Full access), and otherwise Builders don't publish; modes the approval gate can't see (Claude Bypass permissions, Codex Approve for me and Full access) run only in a worktree copy. Spark honours the agent's mode: it injects no ask rules of its own (only a coordinated Builder's session routes edits and commands through the gate, to guard its files, and a solo Builder's `git push`/`gh` go to the gate for the publish rules), so a card appears when the agent's mode asks, with the agent's reason. Full auto → PR is the user's authorization to push the task's own branch, open a PR (a draft when checks still fail), and push follow-up fixes and reply on that PR's threads; nothing ever merges.

Read `docs/product/PLAN.md` for product direction and `docs/architecture/PROTOCOL_ALIGNMENT.md` before persistence or agent integration changes. Keep protocol support claims tied to pinned SDK versions and passing contract tests.

## Design principles

- Follow YAGNI, KISS, and DRY: implement what is needed, keep it understandable, and avoid duplicated knowledge.
- Design for today's actual caller. Do not introduce speculative APIs, registries, configuration, or extension systems.
- Abstract around knowledge, side effects, volatility, or a useful test seam that exists today. One caller is enough when the boundary has a concrete purpose.
- Prefer a small meaningful interface over chains of pass-through wrappers.
- Keep decisions pure where practical. Put filesystem, network, process, and clock effects at the edges.
- Make dependencies explicit. Validate external inputs at trust boundaries, including API requests, provider events, tool results, and persisted records.
- Treat agent output and retrieved content as data, not execution authority.
- Prefer clear names, small functions, and explicit control flow over clever or compressed expressions.
- Reduce needless nesting, redundant logic, and pass-through abstractions. Preserve useful boundaries and test seams.

## Organization and duplication

- Organize code by feature and responsibility. Keep related implementation and tests easy to find.
- Keep applications under `apps/`, shared packages under `packages/`, infrastructure under `infra/`, and architecture and decisions under `docs/`.
- Create directories and packages only when they have an actual implementation purpose. Do not scaffold empty abstractions.
- Keep handwritten source and test files at or below 500 lines. Split by coherent responsibility before exceeding the limit; do not compress code to fit.
- Do not manually split generated files, lockfiles, or vendor code to satisfy the source-file limit. Keep them separate from handwritten code.
- When the same UI pattern appears more than twice, extract a shared component. For repeated non-UI behavior, extract a shared function or module.
- Share the repeated behavior or knowledge, not merely similar syntax. Do not combine unrelated behavior into a configurable catch-all component.
- Keep shared code at the narrowest scope that serves its actual callers.
- Frontend code may import shared contracts, but must not import database access, credentials, or provider execution internals.

## Interface conventions

- Follow the design kit in `docs/design/`. Use the shared semantic colors in `apps/web/public/theme.css`; do not hard-code palette colors in feature styles. Load the saved theme before React mounts.
- Keep onboarding and Integrations on the same connection components and query cache. Show only supported connection methods and backend-reported status.
- Use shared outline icons, restrained accent colors and visible keyboard focus; preserve mounted conversations when changing appearance.

## Changes and refactoring

- Make small, coherent changes. Preserve security, data integrity, accessibility, and all requested behavior.
- Refactor only when today's change benefits. Do not broaden a task into unrelated cleanup.
- Preserve observable behavior during refactoring, including errors, side effects, evaluation order, and public contracts, except for the approved behavior change.
- Do not trade readability for fewer lines.
- Preserve mounted UI state, focus, and scroll position during streaming and background refreshes.
- Keep workflow execution independent of the HTTP request or UI connection that observes it. A disconnected progress stream is not a cancellation request.

## No explanatory code comments

- In every mode, add no explanatory code comments, including in tests.
- Do not add docblocks that merely explain implementation.
- Use clear names, small functions, and explicit control flow instead.
- Preserve required license notices and machine-consumed directives. Record any newly required exception and its reason in the completion record.
- Put design rationale in the PR description, completion summary, or appropriate documentation.

## Testing and review

- Test observable behavior and meaningful edge cases. Avoid tests that only mirror the implementation.
- Run checks appropriate to the changed behavior. Report what ran and what remains unverified.
- For execution and persistence changes, cover relevant cancellation, restart recovery, duplicate requests, stale events, and failure cases.
- For UI changes, verify relevant keyboard, focus, accessibility, streaming, and loading behavior.
- Self-review gathers evidence; it is never the final independent verdict.
- Keep provider claims, reviewer opinions, executable checks, and human acceptance distinct. Do not claim independent verification when none occurred.
- Completion records identify the behavior changed, validation evidence, material limitations, and any required comment exception.

## Repository maintenance

- Keep this file concise and current. Update it when approved conventions change.
- Document runnable development and verification commands as the repository is implemented; do not claim nonexistent commands or checks.
- Keep secrets out of source control, logs, browser bundles, and agent-visible artifacts.

## Commands

- Run `pnpm test:db` for storage changes against an isolated PostgreSQL schema in `TEST_DATABASE_URL` (falls back to `DATABASE_URL`); `pnpm db:setup` writes both to `.local/credentials.env`.
- Run `pnpm check` (format, lint, typecheck, source rules, unused files and exports via knip, contrast audit, ACP coverage, unit tests) and `pnpm test:browser` for browser behavior. Set `SPARK_WEB_BUILD=1` to run browser specs against a production build of the web app (the map perf spec holds the tree to 50 ms tasks there).
- Run `pnpm db:setup` once for the isolated native macOS PostgreSQL cluster, then `pnpm db:up`, `pnpm db:migrate` and `pnpm dev`. Stop only this cluster with `pnpm db:stop`; preserve `.local` data and ignored credentials. See `infra/local/README.md`.
- The user guide lives in `docs/guide/` (Markdown with frontmatter; see its README). The app bundles it into Docs and agents read it with `spark_docs`. Run `pnpm docs:screenshots` to regenerate its light and dark screenshots from a seeded demo test database (`tests/browser/docs-shots.spec.ts`).
- Run `pnpm desktop:dev` for the Electron shell (dev channel, own data folder and bundled Postgres); see `docs/architecture/ELECTRON_PLAN.md`.
- Run `pnpm desktop:package` for an unsigned local build in `apps/desktop/release/` and `pnpm desktop:e2e-update` for the local update check; releases, signing and the update feed are in `docs/architecture/RELEASES.md`. Never publish a build without user authorization.
- Do not create or publish a remote repository, push, or deploy without user authorization.
