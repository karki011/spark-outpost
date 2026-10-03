import { describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { gate, noulGate, optionConfidence } from './gate.ts';

const LEVELS: InvolvementLevel[] = ['hands-off', 'full-auto'];

describe('choice gate', () => {
  it('acts at the question’s own line at every level, never lower', () => {
    for (const level of LEVELS) {
      expect(gate(0.9, 'tier', level, 'destructive').decision).toBe('act');
      expect(gate(0.89, 'tier', level, 'destructive').decision).not.toBe('act');
    }
  });

  it('never acts at 0.6 on destructive work: it falls back to the rules', () => {
    expect(gate(0.6, 'tier', 'hands-off', 'destructive').decision).toBe('fallback');
    expect(gate(0.6, 'tier', 'full-auto', 'destructive').decision).toBe('fallback');
  });

  it('records the line it used', () => {
    expect(gate(0.95, 'tier', 'hands-off', 'edits')).toEqual({
      decision: 'act',
      confidence: 0.95,
      risk: 'edits',
      level: 'hands-off',
      actAt: 0.9,
      askAt: 0.5,
      clarifyBelow: null,
    });
  });
});

describe('noul gate', () => {
  it('acts on a sure yes or no at every level', () => {
    for (const level of LEVELS) {
      expect(noulGate(0.92, 'question', level, 'edits').value).toBe(true);
      expect(noulGate(0.05, 'question', level, 'edits').value).toBe(false);
    }
  });

  it('falls back to the rules when unsure', () => {
    expect(noulGate(0.6, 'question', 'hands-off', 'edits')).toMatchObject({
      value: null,
      gate: { decision: 'fallback' },
    });
  });

  it('treats a missing or broken answer as no answer', () => {
    expect(noulGate(null, 'vague', 'hands-off', 'edits')).toEqual({ value: null, gate: null });
    expect(noulGate(Number.NaN, 'vague', 'hands-off', 'edits')).toEqual({
      value: null,
      gate: null,
    });
  });
});

describe('confidence formula', () => {
  it('is (n·p − 1) / (n − 1), as TypeSafe reports it for a Choice or Score', () => {
    expect(optionConfidence(0.9, 3)).toBeCloseTo(0.85);
    expect(optionConfidence(1 / 3, 3)).toBeCloseTo(0);
    expect(optionConfidence(0.75, 2)).toBeCloseTo(0.5);
    expect(optionConfidence(0.55, 10)).toBeCloseTo(0.5);
    expect(optionConfidence(0.1, 4)).toBe(0);
    expect(optionConfidence(1, 1)).toBe(1);
  });
});
