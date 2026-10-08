import { describe, expect, it } from 'vitest';
import { answerSchema, haikuCostUsd, parseCli } from './versus-ask.ts';
import {
  agreement,
  expectedCalibrationError,
  lineForPrecision,
  percentile,
  readChoice,
  readLevels,
  readNoul,
  readScore,
  recallAt,
  reliability,
  summarise,
  type Judged,
} from './versus-score.ts';

const judged = (top: number, right: boolean): Judged => ({
  read: { pick: 'a', top, confidence: 2 * top - 1, mass: 1 },
  truth: right ? 'a' : 'b',
});

describe('reading answers', () => {
  it('normalises choice probabilities and rescales the top one to a confidence', () => {
    const read = readChoice({ build: 1.2, question: 0.4, needs_you: 0.2, small_change: 0.2 })!;
    expect(read.pick).toBe('build');
    expect(read.mass).toBeCloseTo(2);
    expect(read.top).toBeCloseTo(0.6);
    expect(read.confidence).toBeCloseTo((4 * 0.6 - 1) / 3);
    expect(readChoice({ a: 0.5, b: -0.1 })).toBeNull();
    expect(readChoice({ a: 0, b: 0 })).toBeNull();
  });

  it('reads a rubric as its expected level, as Jev reports a score', () => {
    const read = readLevels([0.1, 0.2, 0.6, 0.1, 0])!;
    expect(read.pick).toBe('2');
    expect(read.confidence).toBeCloseTo((5 * 0.6 - 1) / 4);
    expect(readLevels([0.5])).toBeNull();
    const jev = readScore(1.21, 0.81, 5)!;
    expect(jev.pick).toBe('1');
    expect(jev.top).toBeCloseTo((0.81 * 4 + 1) / 5);
  });

  it('reads a noul on both sides of a half', () => {
    expect(readNoul(0.9)).toMatchObject({ pick: 'true', top: 0.9 });
    expect(readNoul(0.2)!.pick).toBe('false');
    expect(readNoul(0.2)!.confidence).toBeCloseTo(0.6);
    expect(readNoul(1.2)).toBeNull();
  });
});

describe('scoring', () => {
  const rows = [
    judged(0.95, true),
    judged(0.95, true),
    judged(0.95, false),
    judged(0.95, true),
    judged(0.65, true),
    judged(0.65, false),
    { ...judged(0.99, true), truth: null },
  ];

  it('counts accuracy and Brier over labelled rows only', () => {
    const summary = summarise(rows, 0.8);
    expect(summary.n).toBe(7);
    expect(summary.labelled).toBe(6);
    expect(summary.accuracy).toBeCloseTo(4 / 6);
    const brier = (3 * 0.05 ** 2 + 0.95 ** 2 + 0.35 ** 2 + 0.65 ** 2) / 6;
    expect(summary.brier).toBeCloseTo(brier);
  });

  it('reports how often a model acts at a line and how often it is right when it does', () => {
    const summary = summarise(rows, 0.8);
    expect(summary.acted).toBe(5);
    expect(summary.actRate).toBeCloseTo(5 / 7);
    expect(summary.actedLabelled).toBe(4);
    expect(summary.actPrecision).toBeCloseTo(0.75);
    expect(summarise([], 0.8)).toMatchObject({ accuracy: null, actRate: null, actPrecision: null });
  });

  it('bins stated probability against outcomes and weighs the gap by bin size', () => {
    const bins = reliability(rows).filter((bin) => bin.n > 0);
    expect(bins.map((bin) => [bin.from, bin.n, bin.accuracy])).toEqual([
      [0.6, 2, 0.5],
      [0.9, 4, 0.75],
    ]);
    expect(expectedCalibrationError(rows)).toBeCloseTo((2 * 0.15 + 4 * 0.2) / 6);
    expect(expectedCalibrationError([])).toBeNull();
  });

  it('finds the lowest line that reaches a target precision with enough acted rows', () => {
    const many = [...Array.from({ length: 6 }, () => judged(0.95, true)), judged(0.75, false)];
    expect(lineForPrecision(many, 0.9)).toBe(0.6);
    expect(lineForPrecision(many, 0.9, 10)).toBeNull();
  });

  it('measures agreement, percentiles and recall', () => {
    const a = readNoul(0.9)!;
    const b = readNoul(0.6)!;
    const c = readNoul(0.1)!;
    expect(
      agreement([
        [a, b],
        [a, c],
      ]),
    ).toMatchObject({ n: 2, samePick: 0.5 });
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
    expect(recallAt(['a', 'b', 'c'], ['b', 'z'], 2)).toBe(0.5);
    expect(recallAt(['a'], [], 2)).toBeNull();
  });
});

describe('asking Haiku', () => {
  it('asks for a number per option, per rubric level and per noul', () => {
    const schema = answerSchema({
      need: { type: 'choice', criteria: { build: {}, question: {} } },
      stakes: { type: 'score', criteria: ['low', 'high'] },
      vague: { type: 'noul', criteria: {} },
    });
    expect(schema.required).toEqual(['need', 'stakes', 'vague']);
    expect(schema.properties.need).toMatchObject({ required: ['build', 'question'] });
    expect(schema.properties.stakes).toMatchObject({ required: ['level_0', 'level_1'] });
    expect(schema.properties.vague).toEqual({ type: 'number' });
  });

  it('prices a prompt over 100K tokens at the long rate', () => {
    expect(haikuCostUsd({ input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0.5);
    expect(
      haikuCostUsd({ input: 50_000, cacheRead: 0, cacheWrite: 0, output: 10_000 }),
    ).toBeCloseTo(0.01);
  });

  it('names a timeout, a missing result and a missing structured answer', () => {
    expect(parseCli('', 5, true).failure).toBe('timeout');
    expect(parseCli('warning\n', 5, false).failure).toBe('no json from the cli');
    const text = JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 }, result: 'hi' });
    expect(parseCli(text, 5, false)).toMatchObject({
      ok: false,
      failure: 'no structured output',
      tokens: { input: 10, output: 5 },
    });
    const answered = JSON.stringify({ structured_output: { vague: 0.2 }, duration_api_ms: 900 });
    expect(parseCli(`note\n${answered}`, 5, false)).toMatchObject({
      ok: true,
      apiMs: 900,
      answers: { vague: 0.2 },
    });
  });
});
