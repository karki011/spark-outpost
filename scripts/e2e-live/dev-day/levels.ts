/**
 * The permission levels a developer picks in the chat's settings, in one place.
 *
 * The app is moving to four levels: Ask / Ask before edits / Auto-edit / Full auto, with
 * Hands-on removed and Full auto opening a draft PR. Until that lands, each level maps to
 * today's `permission` (run mode) and `level` (involvement) values. When the rename merges,
 * update only the `permission` and `level` values below (and `DIRECT_LEVEL`); sessions refer
 * to levels by key.
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
 * The direct arms have no levels; they run like scripts/bench's direct arm (`BENCH_LEVEL`,
 * today 'full-auto'). Named here so the report can say what the direct arms ran at.
 */
export const DIRECT_LEVEL_LABEL = 'Full auto (scripts/bench BENCH_LEVEL)';

/** The heading the harness puts in Builder and Critic prompts when an agreed plan is loaded. */
export const AGREED_PLAN_MARKER = '## Agreed plan';
