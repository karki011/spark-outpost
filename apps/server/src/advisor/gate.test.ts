import { describe, expect, it } from 'vitest';
import type { InvolvementLevel, Risk } from '@spark-outpost/contracts';
import { gate } from './gate.ts';

const decide = (confidence: number, risk: Risk, level: InvolvementLevel) =>
  gate({ confidence }, risk, level).decision;

describe('confidence gate', () => {
  it.each([
    [0.9, 'edits', 'act'],
    [0.89, 'edits', 'act'],
    [0.75, 'read-only', 'act'],
    [0.74, 'read-only', 'act'],
    [0.6, 'destructive', 'act'],
    [0.59, 'destructive', 'ask'],
    [0.5, 'multi-file', 'ask'],
    [0.49, 'multi-file', 'fallback'],
    [0, 'read-only', 'fallback'],
  ] as const)('balanced: %f with %s risk → %s', (confidence, risk, decision) => {
    expect(decide(confidence, risk, 'balanced')).toBe(decision);
  });

  it.each([
    [0.9, 'act'],
    [0.89, 'act'],
    [0.75, 'act'],
    [0.74, 'ask'],
    [0.5, 'ask'],
    [0.49, 'fallback'],
  ] as const)('hands-on with edits: %f → %s', (confidence, decision) => {
    expect(decide(confidence, 'edits', 'hands-on')).toBe(decision);
  });

  it.each([
    [0.9, 'act'],
    [0.5, 'act'],
    [0.49, 'fallback'],
  ] as const)('hands-off never asks: %f → %s', (confidence, decision) => {
    expect(decide(confidence, 'destructive', 'hands-off')).toBe(decision);
  });

  it.each([
    [0.9, 'edits', 'act'],
    [0.89, 'edits', 'fallback'],
    [0.75, 'read-only', 'act'],
    [0.74, 'read-only', 'fallback'],
    [0.49, 'edits', 'fallback'],
  ] as const)('full auto lets the rules decide below the act line: %f %s → %s', (c, risk, d) => {
    expect(decide(c, risk, 'full-auto')).toBe(d);
  });

  it('acts on read-only work from 0.75 and on anything else from 0.9', () => {
    expect(gate({ confidence: 0.8 }, 'read-only', 'hands-on')).toEqual({
      decision: 'act',
      confidence: 0.8,
      risk: 'read-only',
      level: 'hands-on',
      actAt: 0.75,
      askAt: 0.5,
      clarifyBelow: 0.75,
    });
    expect(gate({ confidence: 0.8 }, 'edits', 'hands-on')).toMatchObject({
      decision: 'act',
      actAt: 0.9,
    });
    expect(gate({ confidence: 0.7 }, 'edits', 'hands-on').decision).toBe('ask');
  });

  it.each([
    [0.8, 'edits', true, 'act'],
    [0.79, 'edits', true, 'fallback'],
    [0.85, 'edits', false, 'fallback'],
    [0.85, 'multi-file', true, 'fallback'],
    [0.75, 'read-only', true, 'act'],
  ] as const)(
    'full-auto: %f with %s risk, downgrade %s → %s',
    (confidence, risk, downgrade, decision) => {
      expect(gate({ confidence }, risk, 'full-auto', { downgrade }).decision).toBe(decision);
    },
  );

  it('lets a planner that only reads act on a cheaper pick at 0.8 for any risk but destructive', () => {
    const options = { downgrade: true, readsOnly: true };
    expect(gate({ confidence: 0.8 }, 'multi-file', 'full-auto', options).decision).toBe('act');
    expect(gate({ confidence: 0.85 }, 'destructive', 'full-auto', options).decision).toBe(
      'fallback',
    );
    expect(gate({ confidence: 0.85 }, 'multi-file', 'full-auto', { readsOnly: true }).actAt).toBe(
      0.9,
    );
  });
});
