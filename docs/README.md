# Spark Outpost docs

What each document is for. Each one describes what runs today plus its open items; older plans, round-by-round logs and review screenshots were removed and live in git history. Start with [AGENTS.md](../AGENTS.md).

## Product

- [product/PLAN.md](product/PLAN.md): product direction, scope and phases.

## Architecture

- [PROTOCOL_ALIGNMENT.md](architecture/PROTOCOL_ALIGNMENT.md): pinned protocol and SDK versions and the claims tied to them. Read before persistence or agent integration changes.
- [HARNESS_PLAN.md](architecture/HARNESS_PLAN.md): the harness around every agent turn: routing, build, checks, review, shipping, autonomy levels, provider permission modes and the safety floor.
- [COORDINATOR_PLAN.md](architecture/COORDINATOR_PLAN.md): coordinator delegation (splitting a story into Builder pieces, placement, steering, integration) and its open items.
- [ROUTING_PLAN.md](architecture/ROUTING_PLAN.md): code scan, file ranking and route questions; rollout steps.
- [JEV.md](architecture/JEV.md): the Jev decision service: questions in use, data sent, rules for new uses.
- [MODEL_CARDS.md](architecture/MODEL_CARDS.md): vendor facts and measured numbers per model, and how tiers are picked.
- [ANALYTICS_PLAN.md](architecture/ANALYTICS_PLAN.md): the Analytics page and workflow optimizer; phases 4–6 are open.
- [PROJECT_MAP.md](architecture/PROJECT_MAP.md): the Project Map builder, storage, API and page.
- [ELECTRON_PLAN.md](architecture/ELECTRON_PLAN.md): the desktop shell and what packaging still needs.
- [REPO_AGENT_CONFIG.md](architecture/REPO_AGENT_CONFIG.md): how a linked repo's agent config, MCP servers and Spark's own tools reach agents.
- [ACP_AGENTS.md](architecture/ACP_AGENTS.md): how Claude, Codex and Z.ai run over ACP.
- [ACP_COMPLIANCE.md](architecture/ACP_COMPLIANCE.md): spec audit and what each adapter advertises.
- [ACP_COVERAGE.md](architecture/ACP_COVERAGE.md): ACP client coverage table, generated and checked by `pnpm acp:coverage` from `acp-coverage.json`.
- [PATCHES.md](architecture/PATCHES.md): the codex-acp patch parts, guard tests, upstream issues and PRs, and the upgrade checklist.
- [CODEX_DO.md](architecture/CODEX_DO.md): the live probe behind Codex in Do mode.

## Design

- [design/README.md](design/README.md): the design kit: the full mockup (the design target), Tickets, Home and Project Map mockups, logo files.
- [design/ACCESSIBILITY.md](design/ACCESSIBILITY.md): WCAG 2.2 AA rules and the contrast audit.
- [design/ux/spark-outpost-ux-flow.md](design/ux/spark-outpost-ux-flow.md): UX principles, glossary, shell, motion, keyboard and copy rules.
- [design/tickets/TICKETS_SCREEN_PLAN.md](design/tickets/TICKETS_SCREEN_PLAN.md): Tickets inbox and Home brief: decisions, attention rules, open items.

## Benchmarks

Raw round data stays next to each report; `apps/server/src/model-cards/measured-seed.json` cites the `harness-vs-direct-2026-09-26*.json` files.

- [e2e-2026-09-29.md](benchmarks/e2e-2026-09-29.md): latest end-to-end verification: deterministic suites, the live provider × feature matrix, and the dev-day rerun with all three arms.
- [dev-day-PLAN.md](benchmarks/dev-day-PLAN.md): the live dev-day e2e plan used by `pnpm e2e:live`.
- [harness-e2e-lean-2026-09-27.md](benchmarks/harness-e2e-lean-2026-09-27.md) and [harness-e2e-live-2026-09-26.md](benchmarks/harness-e2e-live-2026-09-26.md): evidence for the lean harness.
- [harness-vs-direct-2026-09-26-round3.md](benchmarks/harness-vs-direct-2026-09-26-round3.md) and `harness-vs-direct.html`: harness vs direct rounds (the HTML is rewritten by `pnpm bench:harness`).
- [routing-shadow-2026-09-27.md](benchmarks/routing-shadow-2026-09-27.md), [routing-live-2026-09-27.md](benchmarks/routing-live-2026-09-27.md), [verifier-2026-09-27.md](benchmarks/verifier-2026-09-27.md), [codescan-2026-09-27.md](benchmarks/codescan-2026-09-27.md): evidence for the routing and verification policies.

## Reference

- [reference/acp/README.md](reference/acp/README.md): the pinned ACP v1 schema (`schema.json`) and how to update it.
- [reference/zai/GLM_NOTES.md](reference/zai/GLM_NOTES.md): what we rely on from the Z.ai docs.
