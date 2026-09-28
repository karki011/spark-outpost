/**
 * The permission levels a developer picks in the chat's settings, in one place.
 *
 * The app's four choices (packages/contracts/src/approvals.ts ACCESS_CHOICES): Ask (permission
 * `ask`, no level), Ask before edits (`do` + `balanced`), Auto-edit (`do` + `hands-off`) and
 * Full auto (`do` + `full-auto`, which runs in a worktree and ends in a draft PR). Hands-on is
 * gone (migration 0049 maps it to `balanced`). Ask sends `balanced` as its level; the app ignores
 * the level when the permission is `ask`. Sessions refer to levels by key.
 */
export const LEVELS = {
  ask: { label: 'Ask', permission: 'ask', level: 'balanced' },
  askBeforeEdits: { label: 'Ask before edits', permission: 'do', level: 'balanced' },
  autoEdit: { label: 'Auto-edit', permission: 'do', level: 'hands-off' },
  fullAuto: { label: 'Full auto', permission: 'do', level: 'full-auto' },
} as const satisfies Record<string, { label: string; permission: string; level: string }>;

export type LevelKey = keyof typeof LEVELS;

/** The level a developer leaves the app on for most of the day. */
export const DEFAULT_LEVEL: LevelKey = 'askBeforeEdits';

/**
 * The direct arms have no levels; they run like scripts/bench's direct arm (`BENCH_LEVEL` =
 * 'full-auto': every tool call allowed, no orchestrator, so no worktree and no draft PR).
 */
export const DIRECT_LEVEL_LABEL = 'Full auto (scripts/bench BENCH_LEVEL)';

/** The heading the harness puts in Builder and Critic prompts when an agreed plan is loaded. */
export const AGREED_PLAN_MARKER = '## Agreed plan';
