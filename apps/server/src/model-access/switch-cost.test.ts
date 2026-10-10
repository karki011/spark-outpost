import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import { sessionWarm, switchCostUsd, type ResumableSession } from './switch-cost.ts';

const NOW = new Date('2026-09-30T12:00:00Z');
const SONNET: AgentPick = {
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  effort: 'high',
};
const OPUS = { id: 'opus[1m]', label: 'Opus 5.5' };

function session(contextTokens: number, idleMs: number): ResumableSession {
  return { pick: SONNET, contextTokens, lastUsedAt: new Date(NOW.getTime() - idleMs) };
}

describe('the cost of changing a session to another model', () => {
  it('is a fresh read on the new model minus a cached read on the old one', () => {
    expect(switchCostUsd(session(48_000, 60_000), OPUS, NOW)).toBeCloseTo(0.048 * (5 - 0.2), 6);
  });

  it('is lower once the prompt cache has gone cold', () => {
    expect(sessionWarm(session(48_000, 60_000), NOW)).toBe(true);
    expect(sessionWarm(session(48_000, 30 * 60_000), NOW)).toBe(false);
    expect(switchCostUsd(session(48_000, 30 * 60_000), OPUS, NOW)).toBeCloseTo(
      0.048 * (5 - 2.5),
      6,
    );
  });

  it('is nothing for the same model and unknown for a model without a card', () => {
    expect(switchCostUsd(session(48_000, 0), { id: 'sonnet', label: 'Sonnet 5' }, NOW)).toBe(0);
    expect(
      switchCostUsd(session(48_000, 0), { id: 'mystery', label: 'Mystery 9' }, NOW),
    ).toBeNull();
  });
});
