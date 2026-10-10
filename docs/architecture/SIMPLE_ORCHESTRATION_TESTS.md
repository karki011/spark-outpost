# Simple orchestration: what happens to each test

Companion to [SIMPLE_ORCHESTRATION.md](SIMPLE_ORCHESTRATION.md), section 5.4. Written October 10, 2026 after phase B. The owner's rule: tests of removed things are deleted, not ported; each kept behaviour gets one focused test on the new turn.

How the verdicts were reached. Every server test file (`apps/server/src/**/*.test.ts`, `apps/server/test/*.test.ts`) and browser spec (`tests/browser/*.spec.ts`) was checked for imports of files that phases C and D delete and of the old turn's test support (`orchestration-support.ts`, the Coordinator supports, `crew-engine.ts`, `jev-stub.ts`). The 36 server db tests of kept subjects that use that support were then run once with the worker calling `runChatTurn` (a local edit, not committed): 15 files passed unmodified and 21 failed, most of them only because the old support's `driveToEnd` requires an orchestration row. Browser specs were not run. Web unit tests (`apps/web/src/**`) are not listed; they go with their components in D7 and D8.

- **DELETED**: the subject is removed.
- **REPLACED**: a focused test on the new turn already covers the kept behaviour; the old file is deleted.
- **REPLACED (to write)**: the subject is kept, the old file cannot run without the orchestrator, and the named focused test is written in phase C (server) or D9 (browser).
- **KEPT (edited)**: the file stays; the named cases or imports change.
- **KEPT**: unchanged. Listed only when the file touches the old support; every file not named here is KEPT as is.

## Totals

|                              | Files | Lines  |
| ---------------------------- | ----- | ------ |
| Server: DELETED              | 139   | 19,405 |
| Server: REPLACED             | 19    | 3,456  |
| Server: REPLACED (to write)  | 15    | 2,560  |
| Server: KEPT (edited)        | 28    | 5,094  |
| Server: KEPT                 | 553   | 81,812 |
| Browser: DELETED             | 15    | 1,771  |
| Browser: REPLACED            | 0     | 0      |
| Browser: REPLACED (to write) | 4     | 789    |
| Browser: KEPT (edited)       | 35    | 8,258  |
| Browser: KEPT                | 119   | 25,239 |

## Server tests

### DELETED

- `src/advisor/` (8 files, 1,101 lines): `choice-answer` (50), `finding-questions` (230), `gate` (66), `intake-questions` (385), `policy-gate` (104), `rating-questions` (65), `turn-category` (55), `verify-questions` (146)
- `src/approvals/` (2 files, 293 lines): `decide-piece-matrix` (169), `decide-pieces` (124)
- `src/checks/` (3 files, 304 lines): `attribution` (118), `project-checks` (52), `scope` (134)
- `src/coordinator/` (28 files, 2,857 lines): `assign` (54), `builder-count` (109), `builder-groups` (92), `critic-pieces` (62), `edit-evidence` (111), `engage` (112), `follow-up` (35), `graph` (20), `integrator` (62), `mid-build-question` (61), `needs` (56), `notes` (142), `piece-demand` (194), `piece-questions` (174), `piece-routes` (345), `piece-run` (18), `pieces-trim` (18), `pieces-validate` (303), `placement` (37), `plan-coverage` (80), `prompts` (120), `provider-state` (17), `report` (128), `schedule` (129), `scoped-checks` (70), `size` (26), `steer-rules` (61), `summary` (221)
- `src/laws/` (6 files, 592 lines): `claims` (108), `demotion` (90), `estimate` (57), `goodhart` (107), `removals` (181), `review` (49)
- `src/orchestration/` (33 files, 4,194 lines): `builder-complexity` (237), `builder-effort` (59), `cascade` (139), `check-results` (134), `checkpoint-policy` (156), `checks` (38), `clarify` (47), `critic-fix` (57), `critic-recheck` (57), `critic-rule` (144), `critic-scope` (120), `escalation` (222), `final-reply` (52), `follow-up` (49), `full-auto-ship` (40), `intake` (350), `intent-start` (110), `lean` (160), `likely-files` (41), `loop-guard` (62), `observe-content` (27), `policy` (356), `result-facts` (50), `retiring-models` (203), `review-loop` (279), `review` (31), `route-score` (263), `routing` (164), `session-keep` (62), `simple-intake` (60), `stall-watch` (39), `task-signals` (70), `transitions` (316)
- `src/plans/` (1 files, 46 lines): `agreement` (46)
- `src/routing/` (6 files, 660 lines): `file-evidence` (201), `file-ranking` (37), `labels` (116), `route-policy` (96), `route-state` (110), `select-route` (100)
- `test/` (52 files, 9,358 lines): `advice` (270), `build-plan` (211), `check-baselines` (179), `check-blame` (268), `code-context` (189), `codex-crew` (113), `content-rank` (312), `continue-builder` (180), `coordinator-blast-radius` (123), `coordinator-builders` (195), `coordinator-jev-routes` (355), `coordinator-ownership` (190), `coordinator-parallel` (260), `coordinator-pieces` (457), `coordinator-providers` (85), `coordinator-shadow` (115), `coordinator-shared-ship` (95), `coordinator-steering` (213), `crew-overhead` (217), `crossing-change` (138), `escalation-routes` (117), `jev-intake` (115), `lean-history` (114), `member-messages` (466), `mid-build` (183), `model-access-crew` (88), `observation` (121), `orchestration-cascade` (191), `orchestration-check-limits` (161), `orchestration-checks` (272), `orchestration-contract` (130), `orchestration-critic-fix` (369), `orchestration-critic-provider` (43), `orchestration-critic-resolved` (102), `orchestration-intake` (134), `orchestration-intent-start` (108), `orchestration-intent` (211), `orchestration-lean` (131), `orchestration-plan` (90), `orchestration-races` (54), `orchestration-smart-checks` (224), `orchestration` (237), `orchestration` (65), `piece-gate` (207), `piece-list-stored` (82), `route-shadow` (179), `routing-export` (88), `scan-shadow` (114), `session-keep` (147), `simple-intake` (220), `universal-laws` (259), `worker-run-turn` (171)

### REPLACED

| File                                         | Lines | Covered by                                                           |
| -------------------------------------------- | ----- | -------------------------------------------------------------------- |
| `src/approvals/decide-force-push.test.ts`    | 125   | decide-publish-chat.test.ts                                          |
| `src/approvals/decide-publish.test.ts`       | 354   | decide-publish-chat.test.ts                                          |
| `src/orchestration/cache-switch.test.ts`     | 51    | model-access/tiers.test.ts, switch-cost.test.ts, floor-model.test.ts |
| `src/orchestration/handoff.test.ts`          | 114   | workflow/session-brief.test.ts after its two summary cases move      |
| `src/orchestration/instruction-turn.test.ts` | 32    | chat-turn.db, chat-turn-whole.db                                     |
| `src/orchestration/model-floor.test.ts`      | 313   | model-access/tiers.test.ts, switch-cost.test.ts, floor-model.test.ts |
| `src/orchestration/spark-off.test.ts`        | 58    | chat-turn.db, chat-turn-whole.db                                     |
| `src/orchestration/tiers.test.ts`            | 102   | model-access/tiers.test.ts, switch-cost.test.ts, floor-model.test.ts |
| `test/agent-publish.db.test.ts`              | 209   | publish-step.db, chat-run-publish.db                                 |
| `test/instruction-turn.db.test.ts`           | 92    | chat-turn.db, chat-turn-whole.db                                     |
| `test/orchestration-flow.db.test.ts`         | 294   | chat-turn.db, chat-turn-whole.db                                     |
| `test/orchestration-full-auto.db.test.ts`    | 406   | publish-step.db, publish-step-places.db, kept-record.db              |
| `test/orchestration-keep-flow.db.test.ts`    | 110   | kept-record.db                                                       |
| `test/plan-capture.db.test.ts`               | 420   | chat-plan-turn.db                                                    |
| `test/plan-turn-ship.db.test.ts`             | 115   | publish-step-places.db, chat-turn-whole.db                           |
| `test/simple-plan-turn.db.test.ts`           | 172   | chat-plan-turn.db                                                    |
| `test/spark-off.db.test.ts`                  | 154   | chat-turn.db, chat-turn-whole.db                                     |
| `test/stop-run.db.test.ts`                   | 216   | chat-turn.db (Stop), chat-turn-whole.db                              |
| `test/ticket-chat-build.db.test.ts`          | 119   | kept-record.db                                                       |

### REPLACED (to write)

| File                                      | Lines | New test                                                                                                                   |
| ----------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| `test/agent-instructions-run.db.test.ts`  | 64    | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/auto-continue.db.test.ts`           | 259   | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/chat-worktree-ship.db.test.ts`      | 90    | chat-worktree.db: the first changing turn makes the worktree and branch, later turns reuse it, a read-only turn makes none |
| `test/chat-worktrees.db.test.ts`          | 324   | chat-worktree.db: the first changing turn makes the worktree and branch, later turns reuse it, a read-only turn makes none |
| `test/command-terminal.db.test.ts`        | 232   | chat-command-terminal.db: a command card opens in the terminal                                                             |
| `test/conversation-delete.db.test.ts`     | 160   | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/conversation-session.db.test.ts`    | 299   | chat-session.db: one session per chat and provider, resumed on the next turn, replaced-session handoff                     |
| `test/decision-export.db.test.ts`         | 125   | decision-export.db rewritten on turn-support: runs, sessions and end reasons per turn, without Jev calls                   |
| `test/orchestration-worktrees.db.test.ts` | 158   | chat-worktree.db: the first changing turn makes the worktree and branch, later turns reuse it, a read-only turn makes none |
| `test/outpost-builder-prompt.db.test.ts`  | 95    | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/project-move.db.test.ts`            | 74    | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/rail-flags.db.test.ts`              | 225   | chat-rail-flags.db: an observed action across a hard rail is flagged and the run goes on                                   |
| `test/stacked-publish.db.test.ts`         | 132   | publish-step-places.db gains a stacked chat case                                                                           |
| `test/teammate-brief.db.test.ts`          | 118   | chat-turn.db gains one case each (they fail today only because the old support demands an orchestration row)               |
| `test/titles.db.test.ts`                  | 205   | chat-titles.db: the agent’s title line names the chat once and a renamed chat stays renamed; the category cases go         |

### KEPT (edited)

| File                                             | Lines | Note                                                                |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------- |
| `src/advisor/jev-breaker.test.ts`                | 136   | import paths move to advisor/jev-types.ts                           |
| `src/advisor/jev-redaction.test.ts`              | 245   | cut to the Map, pull request and companion requests                 |
| `src/advisor/jev-retry.test.ts`                  | 140   | import paths move to advisor/jev-types.ts                           |
| `src/advisor/jev.test.ts`                        | 125   | import paths move to advisor/jev-types.ts                           |
| `src/advisor/noul-requests.test.ts`              | 73    | import paths move to advisor/jev-types.ts                           |
| `src/agents/acp/agent-env.test.ts`               | 63    | drop the Builder blocks (chat-run-session.test.ts covers them)      |
| `src/agents/acp/agents.test.ts`                  | 439   | drop the Builder blocks (chat-run-session.test.ts covers them)      |
| `src/agents/acp/session-start.test.ts`           | 44    | drop the Builder blocks (chat-run-session.test.ts covers them)      |
| `src/agents/acp/spark-instructions.test.ts`      | 201   | drop the Spark-off cases                                            |
| `src/approvals/decide-nested.test.ts`            | 198   | drop the piece cases and builder: true                              |
| `src/approvals/decide-planning.test.ts`          | 121   | drop the piece cases and builder: true                              |
| `src/approvals/decide-session-audit.test.ts`     | 148   | drop the piece cases and builder: true                              |
| `src/approvals/decide-taint.test.ts`             | 314   | drop the piece cases and builder: true                              |
| `src/approvals/decide-temp.test.ts`              | 188   | drop the piece cases and builder: true                              |
| `src/approvals/decide-worktree-commands.test.ts` | 252   | drop the piece cases and builder: true                              |
| `src/approvals/decide.test.ts`                   | 424   | drop the piece cases and builder: true                              |
| `src/approvals/stacked-push.test.ts`             | 119   | drop the piece cases and builder: true                              |
| `src/orchestration/context.test.ts`              | 334   | trimmed with context.ts to the publish lines                        |
| `src/orchestration/view.test.ts`                 | 232   | imports of checkpoint.ts and final-message.ts change                |
| `src/workflow/member-inbox.test.ts`              | 39    | drop the member prompt case                                         |
| `test/acp-approvals.test.ts`                     | 229   | drop the loop-guard case                                            |
| `test/agent-instructions.db.test.ts`             | 128   | drop the Spark-off cases                                            |
| `test/agent-prompt.test.ts`                      | 180   | drop the Coordinator and member prompts                             |
| `test/gh-reads.db.test.ts`                       | 161   | drop the piece cases and builder: true                              |
| `test/orchestration-migration.db.test.ts`        | 85    | orchestration rows read by the migration stay; drop the driven turn |
| `test/plan-phase-gate.db.test.ts`                | 213   | drop the piece cases and builder: true                              |
| `test/publish-follow-up.db.test.ts`              | 156   | drop the piece cases and builder: true                              |
| `test/spark-profile.db.test.ts`                  | 107   | drop the Spark-off cases                                            |

### KEPT

| File                                    | Lines | Note                                                                                                                                          |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/orchestration/view-stored.test.ts` | 94    | reader of stored rows                                                                                                                         |
| `test/compaction-card.db.test.ts`       | 122   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/compaction-settings.db.test.ts`   | 145   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/compaction.db.test.ts`            | 129   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/continue-interrupted.db.test.ts`  | 424   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/map-answer-cache.db.test.ts`      | 283   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/outpost-agent-prompt.db.test.ts`  | 128   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/outpost-authority.db.test.ts`     | 216   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/outpost-wrap-up-turn.db.test.ts`  | 198   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/outpost-wrap-up.db.test.ts`       | 318   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/plan-documents.db.test.ts`        | 224   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/remote-redaction.db.test.ts`      | 68    | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/reset-worktrees.db.test.ts`       | 92    | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/session-resume.db.test.ts`        | 156   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/spark-handoff.db.test.ts`         | 386   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |
| `test/spark-mcp-runs.db.test.ts`        | 356   | passes unmodified with the worker on runChatTurn; its imports from orchestration-support.ts move to turn-support.ts or a slimmed support file |

## Browser specs

### DELETED

- `tests/browser/` (15 files, 1,771 lines): `chat-rail-crew` (116), `crew-cascade` (55), `crew-checkpoints` (120), `crew-checks` (181), `crew-lean` (40), `crew-overhead` (74), `crew` (268), `keep-flow` (87), `pieces-parallel` (126), `pieces-stream` (153), `pieces` (59), `plans` (121), `steer-bubble` (218), `steer` (108), `universal-laws` (45)

### REPLACED (to write)

| File                                   | Lines | New test                                              |
| -------------------------------------- | ----- | ----------------------------------------------------- |
| `tests/browser/agent-tv-list.spec.ts`  | 162   | agent-tv.spec.ts rewritten for one agent and Sparks   |
| `tests/browser/agent-tv-queue.spec.ts` | 244   | agent-tv.spec.ts rewritten for one agent and Sparks   |
| `tests/browser/agent-tv.spec.ts`       | 311   | agent-tv.spec.ts rewritten for one agent and Sparks   |
| `tests/browser/plan-line.spec.ts`      | 72    | plan-line.spec.ts rewritten for an approved plan only |

### KEPT (edited)

| File                                       | Lines | Note                                                                                                    |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------- |
| `tests/browser/accessibility.spec.ts`      | 499   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/agent-asks.spec.ts`         | 79    | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/approvals.spec.ts`          | 480   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/blob-motion-perf.spec.ts`   | 222   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/chat-questions.spec.ts`     | 159   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/chat-rail.spec.ts`          | 441   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/chat-terminal.spec.ts`      | 288   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/chat-worktree.spec.ts`      | 139   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/command-terminal.spec.ts`   | 280   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/composer-status.spec.ts`    | 270   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/diff-drawer.spec.ts`        | 345   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/diff-shortcut.spec.ts`      | 135   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/docs-shots-batch-1.spec.ts` | 290   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/docs-shots.spec.ts`         | 202   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/feedback.spec.ts`           | 169   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/files-changed.spec.ts`      | 224   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/island-code.spec.ts`        | 335   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/live-diff-perf.spec.ts`     | 197   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/outposts-agents.spec.ts`    | 119   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/outposts-story.spec.ts`     | 234   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/permission-modes.spec.ts`   | 322   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/preview.spec.ts`            | 278   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/provider-effort.spec.ts`    | 85    | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/rail-flags.spec.ts`         | 89    | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/read-then-send.spec.ts`     | 120   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/responsive-chat.spec.ts`    | 161   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/result-block.spec.ts`       | 289   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/send-or-queue.spec.ts`      | 213   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/ship.spec.ts`               | 260   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/shot-order.spec.ts`         | 288   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/sign-ins.spec.ts`           | 270   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/slack-chat.spec.ts`         | 130   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/spark-actions.spec.ts`      | 151   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/ticket-chat.spec.ts`        | 254   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
| `tests/browser/work-panel.spec.ts`         | 241   | uses the crew engine or the Jev stub only to get a reply; runs on the fake agent instead (not run here) |
