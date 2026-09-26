# Protocol alignment

Read this before changing persistence or agent integration. Product direction is in [PLAN.md](../product/PLAN.md). Claims here are tied to pinned versions and passing tests; anything else is marked planned.

## Pinned versions

| Package       | Version                       | Used for                                                            |
| ------------- | ----------------------------- | ------------------------------------------------------------------- |
| `@ag-ui/core` | 1.0.0 (MIT)                   | Event types and Zod schemas for every run event we store and stream |
| `zod`         | 4.6.5                         | Validation at API, event, and configuration boundaries              |
| PostgreSQL    | 17 (Homebrew `postgresql@17`) | Source of truth; matches the planned RDS major version              |

Not installed yet: `@ag-ui/client`, `@agentclientprotocol/sdk`, `@a2a-js/sdk`, CopilotKit.

## What is implemented (phase 0)

| Capability                                                                                          | Status                | Evidence                                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| Run events stored as AG-UI 1.0 events with a per-run sequence                                       | Implemented           | `apps/server/src/persistence/run-events.ts`; `worker.db.test.ts` |
| Events validated against `@ag-ui/core` schemas in the browser                                       | Implemented           | `packages/contracts/src/run-events.ts`, `use-run-stream.ts`      |
| SSE stream with `id: <seq>`, replay from `Last-Event-ID` or `?after=`                               | Implemented           | `api.db.test.ts`                                                 |
| Finished run with nothing after the cursor answers `204`, so `EventSource` stops reconnecting       | Implemented           | `api.db.test.ts`                                                 |
| Client deduplicates replayed events by sequence                                                     | Implemented           | `run-projection.test.ts`                                         |
| Disconnecting a stream does not cancel the run                                                      | Implemented by design | Cancel is only `POST /api/runs/:id/cancel`                       |
| Cancellation ends with `RUN_FINISHED` outcome `cancelled`                                           | Implemented           | `worker.db.test.ts`                                              |
| Provider failure ends with `RUN_ERROR`                                                              | Implemented           | `worker.db.test.ts`                                              |
| Lease fencing: a worker that lost its lease cannot append                                           | Implemented           | `queue.db.test.ts`                                               |
| Expired lease becomes `outcome_unknown` with `RUN_ERROR` code `outcome_unknown`; no automatic retry | Implemented           | `queue.db.test.ts`                                               |
| Idempotent message send by client-generated id                                                      | Implemented           | `conversations.db.test.ts`                                       |
| `LISTEN/NOTIFY` wakes streams and the worker, with 1 s polling fallback                             | Implemented           | `notifications.ts`, `run-stream.ts`, `worker.ts`                 |

## Events emitted today

`RUN_STARTED`, `STEP_STARTED`, `STEP_FINISHED`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `RUN_FINISHED` (outcomes `success`, `cancelled`), `RUN_ERROR` (codes `provider_error`, `outcome_unknown`).

The only provider is the fake provider, which echoes the message. It exists so the pipeline can be tested without a model; it is not evidence of any real provider capability.

## Deviations from the AG-UI client model

- The browser uses `EventSource` and our own reducer, not `@ag-ui/client`. Runs start with `POST /api/conversations/:id/messages`, not with an AG-UI `RunAgentInput` request, because the worker owns execution. Evaluating an `AbstractAgent` with `connect()` is task F-17.
- Assistant text is persisted as a message when `TEXT_MESSAGE_END` is written, in the same transaction.

## Planned, not implemented

| Item                                                                       | Task       |
| -------------------------------------------------------------------------- | ---------- |
| Per-launch token authentication for UI, API, and stream                    | F-9        |
| App-wide status stream                                                     | F-10       |
| ACP coverage spike and ACP client adapter                                  | F-11, F-12 |
| Approvals via AG-UI interrupt outcome and ACP `session/request_permission` | F-13       |
| Usage and context events (`CUSTOM` from ACP `usage_update`)                | F-16       |
| A2A remote agents via `SUBAGENT_*` events                                  | Phase 3    |

## Gates before a protocol claim

1. The SDK version is pinned in `package.json` and recorded above.
2. A test exercises the behavior through our code, not only the SDK's.
3. Live-provider behavior is reported separately from fake-provider tests.
