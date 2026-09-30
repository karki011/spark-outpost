import { describe, expect, it } from 'vitest';
import { ruleSignals, signalText, taskSignals, type RuleFacts } from './task-signals.ts';

const plain: RuleFacts = { trivial: false, destructive: false, complex: null };
const rated = (value: number, confidence = 0.8) => ({ value, confidence });

describe('task signals from the rules', () => {
  it('estimates everyday work when no rule fires', () => {
    expect(signalText(ruleSignals(plain))).toBe('complexity 2, ambiguity 2, stakes 2, context 2');
  });

  it('reads the trivial, complex, destructive, vague and follow-up rules', () => {
    expect(ruleSignals({ ...plain, trivial: true })).toMatchObject({
      complexity: { value: 1 },
      stakes: { value: 1 },
    });
    const migration = { ...plain, complex: { source: 'rules' as const, reason: 'migration' } };
    expect(ruleSignals(migration)).toMatchObject({
      complexity: { value: 4 },
      stakes: { value: 4 },
    });
    const packages = { ...plain, complex: { source: 'rules' as const, reason: 'multi-package' } };
    expect(ruleSignals(packages)).toMatchObject({ complexity: { value: 4 }, stakes: { value: 2 } });
    expect(ruleSignals({ ...plain, destructive: true }).stakes.value).toBe(5);
    expect(ruleSignals({ ...plain, vague: true, continues: true })).toMatchObject({
      ambiguity: { value: 3 },
      contextDependence: { value: 4 },
    });
  });
});

describe('task signals with Jev’s ratings', () => {
  it('takes a confident rating and marks it as Jev’s', () => {
    const signals = taskSignals(plain, { complexity: rated(1), stakes: rated(4) });
    expect(signals.complexity).toEqual({ value: 1, source: 'jev' });
    expect(signals.stakes).toEqual({ value: 4, source: 'jev' });
    expect(signalText(signals)).toBe('complexity 1 (Jev), ambiguity 2, stakes 4 (Jev), context 2');
  });

  it('falls back to the rules when Jev is off, unsure or missing a rating', () => {
    expect(taskSignals(plain, null)).toEqual(ruleSignals(plain));
    expect(taskSignals(plain, { complexity: rated(5, 0.3) }).complexity).toEqual({
      value: 2,
      source: 'rules',
    });
  });

  it('keeps a trivial edit trivial unless Jev rates it clearly bigger', () => {
    const trivial = { ...plain, trivial: true };
    expect(taskSignals(trivial, { complexity: rated(2), stakes: rated(2) })).toMatchObject({
      complexity: { value: 1, source: 'rules' },
      stakes: { value: 1, source: 'rules' },
    });
    expect(taskSignals(trivial, { complexity: rated(3) }).complexity).toEqual({
      value: 3,
      source: 'jev',
    });
  });

  it('never lets Jev clear a complex or high-stakes rule', () => {
    const migration = { ...plain, complex: { source: 'scan' as const, reason: 'migration' } };
    const signals = taskSignals(migration, { complexity: rated(2), stakes: rated(1) });
    expect(signals.complexity).toEqual({ value: 4, source: 'rules' });
    expect(signals.stakes).toEqual({ value: 4, source: 'rules' });
    expect(taskSignals(migration, { complexity: rated(5) }).complexity).toEqual({
      value: 5,
      source: 'jev',
    });
  });
});
