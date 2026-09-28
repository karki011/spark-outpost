import { modeForLegacy } from '../../../packages/contracts/src/agent-modes.ts';

/**
 * The settings a developer picks in the chat, in one place. Since provider permission modes,
 * a chat has the agent's own mode plus a harness autonomy (`level`). The day's sessions still
 * refer to the four old choices by key; each maps to a provider mode and an autonomy the same
 * way migration 0050 maps stored settings (packages/contracts/src/agent-modes.ts modeForLegacy):
 * Ask → Plan (Claude) / Read-only (Codex); Ask before edits → Manual / Ask every time + Review
 * each step; Auto-edit → Accept edits / Approve for me + Automatic; Full auto → Bypass
 * permissions / Approve for me + Full auto → PR (worktree and draft PR).
 */
export const LEVELS = {
  ask: { label: 'Plan (read-only)', permission: 'ask', level: 'balanced' },
  askBeforeEdits: { label: 'Manual · Review each step', permission: 'do', level: 'balanced' },
  autoEdit: { label: 'Accept edits · Automatic', permission: 'do', level: 'hands-off' },
  fullAuto: { label: 'Bypass permissions · Full auto → PR', permission: 'do', level: 'full-auto' },
} as const satisfies Record<string, { label: string; permission: string; level: string }>;

export type LevelKey = keyof typeof LEVELS;

/** The chat settings a level key stands for with a given provider. */
export function levelSettings(key: LevelKey, provider: string) {
  const { permission, level } = LEVELS[key];
  return { agentMode: modeForLegacy(provider, permission, level), level };
}

/** The level a developer leaves the app on for most of the day. */
export const DEFAULT_LEVEL: LevelKey = 'askBeforeEdits';

/**
 * The direct arms have no levels; they run like scripts/bench's direct arm (`BENCH_LEVEL` =
 * 'full-auto': every tool call allowed, no orchestrator, so no worktree and no draft PR).
 */
export const DIRECT_LEVEL_LABEL = 'Full auto → PR (scripts/bench BENCH_LEVEL)';

/** The heading the harness puts in Builder and Critic prompts when an agreed plan is loaded. */
export const AGREED_PLAN_MARKER = '## Agreed plan';
