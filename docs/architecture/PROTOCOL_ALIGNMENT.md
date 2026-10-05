# Protocol alignment

Read this before changing persistence or agent integration. Product direction is in [PLAN.md](../product/PLAN.md). Claims here are tied to pinned versions and passing tests; anything else is marked planned.

## Pinned versions

| Package                                 | Version                                    | Used for                                                                                          |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@ag-ui/core`                           | `^1.0.0` in `package.json`, 1.0.0 resolved | Event types and Zod schemas for every run event we store and stream                               |
| `zod`                                   | `^4.6.5` in `package.json`, 4.6.5 resolved | Validation at API, event, and configuration boundaries                                            |
| PostgreSQL                              | 17 (Homebrew `postgresql@17`)              | Source of truth; matches the planned RDS major version                                            |
| `@agentclientprotocol/sdk`              | 1.5.0                                      | ACP client in the worker ([ACP_AGENTS.md](ACP_AGENTS.md), [ACP_COMPLIANCE.md](ACP_COMPLIANCE.md)) |
| `@agentclientprotocol/claude-agent-acp` | 0.81.2                                     | Claude adapter, also used for the Z.ai (GLM) provider                                             |
| `@agentclientprotocol/codex-acp`        | 1.13.1 (patched, [PATCHES.md](PATCHES.md)) | Codex adapter                                                                                     |

Not installed: `@ag-ui/client`, `@a2a-js/sdk`, CopilotKit.

## What is implemented

| Capability                                                                                                                                                                    | Status                                                                                                                 | Evidence                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Run events stored as AG-UI 1.0 events with a per-run sequence                                                                                                                 | Implemented                                                                                                            | `apps/server/src/persistence/run-events.ts`; `worker.db.test.ts` |
| Events validated against `@ag-ui/core` schemas in the browser                                                                                                                 | Implemented                                                                                                            | `packages/contracts/src/run-events.ts`, `use-run-stream.ts`      |
| SSE stream with `id: <seq>`, replay from `Last-Event-ID` or `?after=`                                                                                                         | Implemented                                                                                                            | `api.db.test.ts`                                                 |
| Finished run with nothing after the cursor answers `204`, so `EventSource` stops reconnecting                                                                                 | Implemented                                                                                                            | `api.db.test.ts`                                                 |
| Client deduplicates replayed events by sequence                                                                                                                               | Implemented                                                                                                            | `run-projection.test.ts`                                         |
| Disconnecting a stream does not cancel the run                                                                                                                                | Implemented by design                                                                                                  | Cancel is only `POST /api/runs/:id/cancel`                       |
| Cancellation ends with `RUN_FINISHED` outcome `cancelled`                                                                                                                     | Implemented                                                                                                            | `worker.db.test.ts`                                              |
| Provider failure ends with `RUN_ERROR`                                                                                                                                        | Implemented                                                                                                            | `worker.db.test.ts`                                              |
| Lease fencing: a worker that lost its lease cannot append                                                                                                                     | Implemented                                                                                                            | `queue.db.test.ts`                                               |
| Expired lease becomes `outcome_unknown` with `RUN_ERROR` code `outcome_unknown`; no automatic retry                                                                           | Implemented                                                                                                            | `queue.db.test.ts`                                               |
| A user-requested continue reopens the interrupted session (`session/resume`, else `session/load`) or falls back to a fresh one; at most one continued run per interrupted run | Implemented (fake agent); live spike reported in [ACP_AGENTS.md](ACP_AGENTS.md#interrupted-turns-spike-october-5-2026) | `continue-interrupted.db.test.ts`, `continue-builder.db.test.ts` |
| Idempotent message send by client-generated id                                                                                                                                | Implemented                                                                                                            | `conversations.db.test.ts`                                       |
| `LISTEN/NOTIFY` wakes streams and the worker, with 1 s polling fallback                                                                                                       | Implemented                                                                                                            | `notifications.ts`, `run-stream.ts`, `worker.ts`                 |

## Events emitted today

`RUN_STARTED`, `STEP_STARTED`, `STEP_FINISHED`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `CUSTOM` (`approval_requested`, `approval_decided`), `ACTIVITY_SNAPSHOT`, `RUN_FINISHED` (outcomes `success`, `cancelled`), `RUN_ERROR` (codes `provider_error`, `outcome_unknown`), built in `apps/server/src/workflow/run-events.ts`.

The worker writes `TEXT_MESSAGE_CONTENT` events in batches: chunks wait at most 50 ms (or 8 KB) and are stored together, each still its own event with its own `seq`. Any other event first stores the waiting text in the same transaction, so the order is the order the agent produced (`apps/server/src/workflow/run-appender.ts`).

Real providers run through ACP (Claude, Codex, Z.ai; see [ACP_AGENTS.md](ACP_AGENTS.md)). The fake provider, which echoes the message, remains for tests; it is not evidence of any real provider capability.

## Deviations from the AG-UI client model

- The browser uses `EventSource` and our own reducer, not `@ag-ui/client`. Runs start with `POST /api/conversations/:id/messages`, not with an AG-UI `RunAgentInput` request, because the worker owns execution. Evaluating an `AbstractAgent` with `connect()` is task F-17.
- Assistant text is persisted as a message when `TEXT_MESSAGE_END` is written, in the same transaction.

## Planned, not implemented

| Item                                      | Task    |
| ----------------------------------------- | ------- |
| App-wide status stream                    | F-10    |
| A2A remote agents via `SUBAGENT_*` events | Phase 3 |

Per-launch token authentication (F-9), the ACP client adapter (F-11, F-12), approvals through ACP `session/request_permission` with `CUSTOM` approval events (F-13) and usage and context readings (F-16) are built; their state is in [ACP_AGENTS.md](ACP_AGENTS.md).

## Gates before a protocol claim

1. The SDK version is pinned in `package.json` and recorded above. (`@ag-ui/core` and `zod` are caret ranges, not pinned; the lockfile currently resolves both to the versions above.)
2. A test exercises the behavior through our code, not only the SDK's.
3. Live-provider behavior is reported separately from fake-provider tests.
