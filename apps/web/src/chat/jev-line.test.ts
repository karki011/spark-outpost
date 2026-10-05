import { describe, expect, it } from 'vitest';
import type { AdviceSummary, IntakeAnswer, IntakeCall } from '@spark-outpost/contracts';
import { jevLine } from './jev-line.ts';

const rules: IntakeAnswer = {
  intent: 'feature',
  complexity: null,
  risk: 'edits',
  injection: null,
  depth: 'direct',
  provider: 'claude',
  model: null,
  modelLabel: null,
  effort: null,
};

const answered: AdviceSummary = {
  purpose: 'intake',
  routing: 'auto',
  rules,
  jev: { ...rules, tier: null, confidence: 0.9, routeConfidence: null, confidences: {} },
  jevStatus: 'answered',
  jevError: null,
  jevModel: 'jev-1',
  gate: null,
  routeGate: null,
  wouldApply: 'jev',
  differences: [],
  latencyMs: 120,
  usage: null,
};

function call(value: boolean, source: IntakeCall['source']): IntakeCall {
  return { jev: source === 'jev' ? 0.9 : null, rule: value, value, source, gate: null };
}

function missing(patch: Partial<AdviceSummary>): AdviceSummary {
  return { ...answered, jev: null, ...patch };
}

describe('jevLine', () => {
  it('says nothing when no intake was recorded for the turn', () => {
    expect(jevLine(undefined)).toBeNull();
  });

  it('credits Jev only for a call Jev decided', () => {
    const byJev = { ...answered, calls: { question: call(true, 'jev') } };
    const byRules = { ...answered, calls: { question: call(true, 'rules') } };
    expect(jevLine(byJev)).toBe('Jev: treated as a question');
    expect(jevLine(byRules)).toBe('Jev answered · rules treated it as a question');
  });

  it('names a plan request, a review, an unclear request and a build', () => {
    const build = { question: call(false, 'jev') };
    expect(jevLine({ ...answered, calls: build })).toBe('Jev: treated as a build');
    expect(jevLine({ ...answered, calls: { ...build, plan: call(true, 'jev') } })).toBe(
      'Jev: treated as a build, plan first',
    );
    expect(jevLine({ ...answered, calls: { ...build, vague: call(true, 'jev') } })).toBe(
      'Jev: found it unclear',
    );
    expect(jevLine({ ...answered, calls: { ...build, vague: call(true, 'rules') } })).toBe(
      'Jev answered · rules found it unclear',
    );
    expect(jevLine({ ...answered, calls: { ...build, plan_only: call(true, 'jev') } })).toBe(
      'Jev: treated as a plan request',
    );
    expect(
      jevLine({
        ...answered,
        calls: { question: call(true, 'rules'), review: call(true, 'jev') },
      }),
    ).toBe('Jev: treated as a review');
  });

  it('says the user chose to build when they started the change themselves', () => {
    const calls = { question: call(false, 'jev'), change: call(true, 'user') };
    expect(jevLine({ ...answered, calls })).toBe('Jev answered · you chose to build');
  });

  it('reports only the category on a turn with no build calls', () => {
    expect(jevLine(answered)).toBe('Jev: read it as Feature');
    expect(jevLine({ ...answered, jev: { ...answered.jev!, intent: null } })).toBe('Jev answered');
  });

  it('says why there is no decision from Jev', () => {
    expect(jevLine(missing({ jevStatus: 'not_connected' }))).toBe('Jev not connected');
    expect(jevLine(missing({ jevStatus: 'timed_out', jevError: 'Slow.' }))).toBe(
      'Jev timed out · rules decided',
    );
    expect(jevLine(missing({ jevStatus: 'failed', jevError: 'Bad key.' }))).toBe(
      'Jev failed · rules decided',
    );
    expect(jevLine(missing({ jevStatus: 'not_asked', jevError: 'Spark is off' }))).toBe(
      'Jev skipped: Spark is off',
    );
    expect(jevLine(missing({ jevStatus: 'not_asked' }))).toBe('Jev skipped');
  });
});
