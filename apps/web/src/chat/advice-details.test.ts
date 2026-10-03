import { describe, expect, it } from 'vitest';
import type { AdviceSummary, IntakeAnswer } from '@spark-outpost/contracts';
import { adviceDetails, jevMissing } from './AdviceChip.tsx';

const rules: IntakeAnswer = {
  intent: 'bug_fix',
  complexity: null,
  risk: 'read-only',
  injection: null,
  depth: 'direct',
  provider: 'claude',
  model: null,
  modelLabel: null,
  effort: null,
};

const advice: AdviceSummary = {
  purpose: 'intake',
  routing: 'auto',
  rules,
  jev: { ...rules, tier: 'small', confidence: 0.8, routeConfidence: 0.7, confidences: {} },
  jevStatus: 'answered',
  jevError: null,
  jevModel: 'jev-1',
  gate: null,
  routeGate: {
    decision: 'act',
    confidence: 0.7,
    risk: 'read-only',
    level: 'hands-off',
    actAt: 0.6,
    askAt: 0.4,
    clarifyBelow: null,
  },
  wouldApply: 'jev',
  differences: [],
  latencyMs: null,
  usage: null,
};

describe('adviceDetails', () => {
  it('lists the tier Jev would have routed to as recorded only', () => {
    expect(adviceDetails(advice)).toContain(
      'Jev would have used the small tier (0.70), recorded only',
    );
  });

  it('leaves the recorded-only tier out when asked to', () => {
    const lines = adviceDetails(advice, { recordedRoute: false });
    expect(lines.some((line) => line.includes('small tier'))).toBe(false);
    expect(lines.some((line) => line.startsWith('Rules ran: Claude'))).toBe(true);
  });
});

describe('when Jev gave no answer', () => {
  const without = (patch: Partial<AdviceSummary>): AdviceSummary => ({
    ...advice,
    jev: null,
    routeGate: null,
    ...patch,
  });

  it.each([
    [without({ jevStatus: 'not_asked' }), 'Jev not asked'],
    [
      without({ jevStatus: 'not_asked', jevError: 'Spark is off for this chat.' }),
      'Jev not asked: Spark is off for this chat',
    ],
    [without({ jevStatus: 'not_connected' }), 'Jev not connected'],
    [without({ jevStatus: 'timed_out', jevError: 'Jev did not answer in time.' }), 'Jev timed out'],
    [without({ jevStatus: 'failed', jevError: 'boom' }), 'Jev failed'],
  ])('names why for %#', (summary, text) => {
    expect(jevMissing(summary)).toBe(text);
  });

  it('says Jev was not asked rather than unavailable in the details', () => {
    expect(adviceDetails(without({ jevStatus: 'not_asked' }))[0]).toBe('Jev not asked.');
    expect(adviceDetails(without({ jevStatus: 'not_connected' }))[0]).toBe('Jev not connected.');
    expect(adviceDetails(without({ jevStatus: 'failed', jevError: 'boom' }))[0]).toBe('boom');
  });
});
