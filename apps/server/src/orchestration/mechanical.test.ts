import { describe, expect, it } from 'vitest';
import type { JevIntake } from '@spark-outpost/contracts';
import { refineDepth } from './depth.ts';
import {
  MECHANICAL_REASON,
  mechanicalByRule,
  mechanicalChange,
  mechanicalSummary,
  worthRecording,
} from './mechanical.ts';

const jev = (mechanical?: number) =>
  ({
    confidence: 0.6,
    confidences: {},
    ...(mechanical === undefined ? {} : { mechanical }),
  }) as unknown as JevIntake;

const planned = { depth: 'plan_execute' as const, source: 'rules' as const, reason: null };

describe('the mechanical-change rule', () => {
  it('needs a rename, move, type-error or lint-fix verb and a named symbol or file', () => {
    expect(mechanicalByRule('Rename `Entry.cents` to `amountCents` everywhere', 0)).toBe(true);
    expect(mechanicalByRule('Rename formatDay to formatDate across the app', 0)).toBe(true);
    expect(mechanicalByRule('Fix the type errors in the ledger module', 1)).toBe(true);
    expect(mechanicalByRule('Fix all lint errors in src/reports', 1)).toBe(true);
    expect(mechanicalByRule('Move parse_date into utils', 0)).toBe(true);
    expect(mechanicalByRule('Rename the thing', 0)).toBe(false);
    expect(mechanicalByRule('Move date handling into one module', 0)).toBe(false);
    expect(mechanicalByRule('Rename formatDay and add a locale option', 0)).toBe(false);
    expect(mechanicalByRule('Make the reports better', 2)).toBe(false);
    expect(mechanicalByRule('Rename formatDay to formatDate. #build', 0)).toBe(true);
  });
});

describe('deciding a mechanical change', () => {
  const rename = 'Rename formatDay to formatDate across the app';

  it('follows a sure Jev and falls back to the rule below the gate', () => {
    expect(mechanicalChange('do', 'multi-file', 'Tidy the reports', 0, jev(0.9))).toEqual({
      mechanical: true,
      source: 'jev',
      jev: 0.9,
      rule: false,
    });
    expect(mechanicalChange('do', 'multi-file', rename, 0, jev(0.1))).toMatchObject({
      mechanical: false,
      source: 'jev',
      rule: true,
    });
    expect(mechanicalChange('do', 'multi-file', rename, 0, jev(0.6))).toMatchObject({
      mechanical: true,
      source: 'rules',
      jev: 0.6,
    });
    expect(mechanicalChange('do', 'multi-file', rename, 0, null)).toMatchObject({
      mechanical: true,
      source: 'rules',
      jev: null,
    });
  });

  it('is not considered outside Do, for small edits or for destructive work', () => {
    expect(mechanicalChange('ask', 'multi-file', rename, 0, jev(0.9))).toBeNull();
    expect(mechanicalChange('do', 'edits', rename, 0, jev(0.9))).toBeNull();
    expect(mechanicalChange('do', 'destructive', rename, 0, jev(0.9))).toBeNull();
  });

  it('records Jev’s answer next to the rule', () => {
    const call = mechanicalChange('do', 'multi-file', rename, 0, jev(0.6))!;
    expect(mechanicalSummary(call)).toBe('mechanical yes (rules; Jev 0.60; rule: yes)');
    const silent = mechanicalChange('do', 'multi-file', 'Tidy up', 0, null)!;
    expect(mechanicalSummary(silent)).toBe('mechanical no (rules; Jev did not answer; rule: no)');
    expect(worthRecording(silent)).toBe(false);
    expect(worthRecording(call)).toBe(true);
  });

  it('skips the Architect for a mechanical plan and keeps plans that are not', () => {
    const call = mechanicalChange('do', 'multi-file', rename, 0, null);
    expect(refineDepth(planned, 'multi-file', 0, null, call)).toEqual({
      ...planned,
      depth: 'execute',
      reason: MECHANICAL_REASON,
    });
    const other = mechanicalChange('do', 'multi-file', 'Tidy up', 0, null);
    expect(refineDepth(planned, 'multi-file', 0, null, other)).toEqual(planned);
    const review = { ...planned, depth: 'plan_execute_review' as const };
    expect(refineDepth(review, 'multi-file', 0, null, call)).toEqual(review);
  });
});
