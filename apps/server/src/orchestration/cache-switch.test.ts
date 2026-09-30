import { describe, expect, it } from 'vitest';
import type { AgentPick } from '@spark-outpost/contracts';
import { keptText, leftText, switchCostUsd, type ResumableSession } from './cache-switch.ts';

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

describe('the cost of leaving a session', () => {
  it('prices a switch as a fresh read on the new model minus a cached read on the old one', () => {
    expect(switchCostUsd(session(48_000, 60_000), OPUS, NOW)).toBeCloseTo(0.048 * (5 - 0.2), 6);
  });

  it('charges less once the prompt cache has gone cold', () => {
    const warm = switchCostUsd(session(48_000, 60_000), OPUS, NOW)!;
    const cold = switchCostUsd(session(48_000, 30 * 60_000), OPUS, NOW)!;
    expect(cold).toBeCloseTo(0.048 * (5 - 2.5), 6);
    expect(cold).toBeLessThan(warm);
  });

  it('grows with the context the session holds', () => {
    const costs = [10_000, 50_000, 200_000].map((tokens) =>
      switchCostUsd(session(tokens, 0), OPUS, NOW)!,
    );
    expect(costs[0]).toBeLessThan(costs[1]!);
    expect(costs[1]).toBeLessThan(costs[2]!);
  });

  it('costs nothing to stay, and is unknown for a model without a card', () => {
    expect(switchCostUsd(session(48_000, 0), { id: 'sonnet', label: 'Sonnet 5' }, NOW)).toBe(0);
    expect(
      switchCostUsd(session(48_000, 0), { id: 'mystery', label: 'Mystery 9' }, NOW),
    ).toBeNull();
  });

  it('says what was kept or left, with the context size', () => {
    expect(keptText(session(48_000, 60_000), NOW)).toBe('kept Sonnet 5: warm session, 48K context');
    expect(leftText('destructive work needs the top tier', session(48_000, 3_600_000), NOW)).toBe(
      'destructive work needs the top tier; left the resumable Sonnet 5 session (48K context)',
    );
  });
});
