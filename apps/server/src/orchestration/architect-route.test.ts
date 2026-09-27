import { describe, expect, it } from 'vitest';
import type { JevIntake, Scope } from '@spark-outpost/contracts';
import {
  architectRule,
  isSimple,
  isVague,
  planShape,
  routeArchitect,
  shortPlan,
  type PlanShape,
} from './architect-route.ts';
import { context } from './route-fixtures.ts';
import type { JevPick } from './routing.ts';

function intake(scope: Scope | null, complexity: number, sure = 0.8, complexitySure = sure) {
  return {
    scope,
    complexity,
    confidences: { scope: sure, complexity: complexitySure },
  } as unknown as JevIntake;
}

const shape = (files: number, jev: JevIntake | null): PlanShape => planShape(files, jev);
const jevPick = (model: string, effort: string, confidence: number): JevPick => ({
  pick: { provider: 'claude', model, modelLabel: model, effort },
  confidence,
});
const multi = { ...context('full-auto'), risk: 'multi-file' as const };

describe('simple and vague requests', () => {
  it('calls a request simple only for one spot or one module at moderate complexity, both sure', () => {
    expect(isSimple(shape(0, intake('one_spot', 1)))).toBe(true);
    expect(isSimple(shape(0, intake('one_module', 2)))).toBe(true);
    expect(isSimple(shape(0, intake('one_module', 2.6)))).toBe(false);
    expect(isSimple(shape(0, intake('few_modules', 1)))).toBe(false);
    expect(isSimple(shape(0, intake('one_module', 1, 0.45)))).toBe(false);
    expect(isSimple(shape(0, intake('one_module', 1, 0.8, 0.3)))).toBe(false);
    expect(isSimple(shape(3, null))).toBe(false);
  });

  it('calls a request vague when it names no files and is not one spot', () => {
    expect(isVague(shape(0, intake('one_module', 1)))).toBe(true);
    expect(isVague(shape(0, intake('one_spot', 1)))).toBe(false);
    expect(isVague(shape(2, intake('codebase', 3)))).toBe(false);
    expect(isVague(shape(0, null))).toBe(true);
  });

  it('trusts Jev complexity only at 0.5 confidence or more', () => {
    expect(planShape(2, intake('one_module', 3, 0.8, 0.4))).toMatchObject({
      files: 2,
      complexity: null,
      sure: false,
    });
    expect(planShape(2, intake('one_module', 3))).toEqual({
      files: 2,
      complexity: 3,
      scope: 'one_module',
      scopeSure: true,
      sure: true,
    });
  });
});

describe('the Architect rule', () => {
  it('keeps the top tier for destructive work that names no files and no narrow scope', () => {
    expect(architectRule('destructive', shape(0, null))).toBe('destructive');
    expect(architectRule('destructive', shape(0, intake('codebase', 1)))).toBe('destructive');
    expect(architectRule('destructive', shape(0, intake('one_module', 1, 0.4)))).toBe(
      'destructive',
    );
  });

  it('gives destructive work that names its files or a narrow scope a Sonnet Architect', () => {
    const destructive = { ...multi, risk: 'destructive' as const };
    expect(architectRule('destructive', shape(1, intake('codebase', 3)))).toBe(
      'narrow destructive',
    );
    expect(architectRule('destructive', shape(0, intake('one_spot', 3)))).toBe(
      'narrow destructive',
    );
    expect(routeArchitect(destructive, shape(2, null))).toMatchObject({
      pick: { model: 'sonnet', effort: 'high' },
      rule: 'narrow destructive',
    });
  });

  it('gives simple work, vague or not, Sonnet at high effort', () => {
    const vagueButSimple = shape(0, intake('one_module', 2));
    expect(architectRule('multi-file', vagueButSimple)).toBe('simple');
    expect(routeArchitect(multi, vagueButSimple)).toMatchObject({
      pick: { model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'high' },
      routedBy: 'fixed',
      rule: 'simple',
    });
  });

  it('keeps the top tier when Jev is unsure, when the request is vague, and when it is complex', () => {
    expect(architectRule('multi-file', shape(2, intake('one_module', 1, 0.4)))).toBe('unsure');
    expect(architectRule('multi-file', shape(0, intake('few_modules', 1)))).toBe('vague');
    expect(architectRule('multi-file', shape(3, intake('few_modules', 3)))).toBe('top tier');
    expect(routeArchitect(multi, shape(0, intake('codebase', 2))).pick).toMatchObject({
      model: 'opus[1m]',
      effort: 'high',
    });
  });

  it('keeps the short-plan rule for a confident request that names its files', () => {
    expect(architectRule('multi-file', shape(3, intake('few_modules', 2)))).toBe('short plan');
    expect(architectRule('multi-file', shape(8, intake('few_modules', 2)))).toBe('short plan');
    expect(architectRule('multi-file', shape(4, null))).toBe('short plan');
    expect(shortPlan('multi-file', shape(5, null))).toBe(false);
    expect(architectRule('multi-file', shape(0, null))).toBe('top tier');
  });
});

describe('Jev picking the Architect', () => {
  const vague = shape(0, intake('few_modules', 2));

  it('acts on a cheaper pick at 0.8 and on an upgrade only at 0.9', () => {
    expect(routeArchitect(multi, vague, jevPick('sonnet', 'high', 0.82))).toMatchObject({
      routedBy: 'jev',
      pick: { model: 'sonnet', effort: 'high' },
      rulePick: { model: 'opus[1m]' },
      gate: { actAt: 0.8, decision: 'act' },
    });
    const simple = shape(0, intake('one_module', 1));
    expect(routeArchitect(multi, simple, jevPick('opus[1m]', 'high', 0.85))).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'sonnet' },
      autoWouldUse: { model: 'opus[1m]' },
      gate: { actAt: 0.9, decision: 'fallback' },
    });
    expect(routeArchitect(multi, simple, jevPick('opus[1m]', 'high', 0.93))).toMatchObject({
      routedBy: 'jev',
      pick: { model: 'opus[1m]' },
    });
  });

  it('falls back to the rule below the gate and records what Jev picked', () => {
    expect(routeArchitect(multi, vague, jevPick('haiku', 'low', 0.7))).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'opus[1m]', effort: 'high' },
      autoWouldUse: { model: 'haiku', effort: 'low' },
      rule: 'vague',
    });
  });

  it('never lets Jev move destructive work off the rule’s tier', () => {
    const destructive = { ...multi, risk: 'destructive' as const };
    expect(routeArchitect(destructive, vague, jevPick('sonnet', 'high', 0.99))).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'opus[1m]' },
      autoWouldUse: { model: 'sonnet' },
      rule: 'destructive',
    });
    const named = shape(2, null);
    expect(routeArchitect(destructive, named, jevPick('opus[1m]', 'high', 0.99))).toMatchObject({
      routedBy: 'rules',
      pick: { model: 'sonnet' },
      autoWouldUse: { model: 'opus[1m]' },
      rule: 'narrow destructive',
    });
  });

  it('keeps a pinned model and records what Auto would have used', () => {
    expect(routeArchitect(context('pinned'), vague, jevPick('sonnet', 'high', 0.95))).toMatchObject(
      {
        routedBy: 'pinned',
        pick: { model: 'sonnet', effort: 'high' },
        autoWouldUse: { model: 'sonnet' },
      },
    );
    expect(routeArchitect(context('pinned'), vague)).toMatchObject({
      routedBy: 'pinned',
      autoWouldUse: { model: 'opus[1m]' },
    });
  });
});
