import { modeForLegacy } from '../../../packages/contracts/src/agent-modes.ts';

export const LEVELS = {
  ask: { label: 'Plan (read-only)', permission: 'ask', level: 'balanced' },
  askBeforeEdits: { label: 'Manual · Review each step', permission: 'do', level: 'balanced' },
  autoEdit: { label: 'Accept edits · Automatic', permission: 'do', level: 'hands-off' },
  fullAuto: { label: 'Bypass permissions · Full auto → PR', permission: 'do', level: 'full-auto' },
} as const satisfies Record<string, { label: string; permission: string; level: string }>;

export type LevelKey = keyof typeof LEVELS;

export function levelSettings(key: LevelKey, provider: string) {
  const { permission, level } = LEVELS[key];
  return { agentMode: modeForLegacy(provider, permission, level), level };
}

export const DEFAULT_LEVEL: LevelKey = 'askBeforeEdits';

export const DIRECT_LEVEL_LABEL = 'Full auto → PR (scripts/bench BENCH_LEVEL)';

export const AGREED_PLAN_MARKER = '## Agreed plan';
