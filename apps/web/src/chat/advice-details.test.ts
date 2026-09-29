import { describe, expect, it } from 'vitest';
import type { AdviceSummary, IntakeAnswer } from '@spark-outpost/contracts';
import { adviceDetails } from './AdviceLine.tsx';

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
    level: 'balanced',
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
