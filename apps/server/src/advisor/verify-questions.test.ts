import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import {
  buildVerdictQuestions,
  MAX_REQUIREMENTS,
  readVerdict,
  requirementLines,
  VERDICTS,
} from './verify-questions.ts';

const answered = (
  choice: string,
  confidence: number,
  nouls: Record<string, number> = {},
): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: {
    verdict: {
      type: 'choice',
      choice,
      confidence,
      probabilities: { [choice]: (2 * confidence + 1) / 3 },
    },
    ...Object.fromEntries(
      Object.entries(nouls).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
    ),
  },
});

describe('requirement lines', () => {
  it('prefers the Builder’s own plan entries', () => {
    expect(requirementLines('Do it all', ['Write the parser', 'Add a test for dates'])).toEqual([
      'Write the parser',
      'Add a test for dates',
    ]);
  });

  it('splits the request into up to five sentences, dropping tags and tiny fragments', () => {
    const request =
      'Fix the divider after midnight. Add a test for it. Update the README heading. Ok. Rename the helper file. Tidy the CSS classes. Bump the version number. #build';
    const lines = requirementLines(request);
    expect(lines).toHaveLength(MAX_REQUIREMENTS);
    expect(lines[0]).toBe('Fix the divider after midnight.');
    expect(lines.join(' ')).not.toContain('#build');
  });

  it('falls back to the whole request when nothing splits out', () => {
    expect(requirementLines('Fix it')).toEqual(['Fix it']);
  });
});

describe('three-way diff verdict', () => {
  const requirements = ['Return 0 when total is 0.', 'Add a test for it.'];

  it('asks one Choice over the three verdicts plus a Noul per requirement, with the evidence as state', () => {
    const asked = buildVerdictQuestions({
      request: 'Add percentOf. Return 0 when total is 0. Add a test for it.',
      plan: [],
      requirements,
      diff: '+export function percentOf',
      checks: ['- `pnpm test` passed'],
    });
    expect(Object.keys(asked.questions)).toEqual(['verdict', 'unmet_1', 'unmet_2']);
    expect(Object.keys(asked.questions.verdict!.criteria as object)).toEqual([...VERDICTS]);
    expect(asked.state).toEqual({
      task: 'Add percentOf. Return 0 when total is 0. Add a test for it.',
      plan: 'No plan was made.',
      checks: '- `pnpm test` passed',
      diff: '+export function percentOf',
    });
  });

  it('caps the diff and redacts secrets before sending', () => {
    const asked = buildVerdictQuestions({
      request: 'Rotate the key',
      plan: ['Change the key'],
      requirements: ['Rotate the key'],
      diff: `+API_KEY=sk-ant-${'a'.repeat(40)}\n${'+x\n'.repeat(20_000)}`,
      checks: [],
    });
    const diff = String(asked.state.diff);
    expect(diff).not.toContain('sk-ant-aaaa');
    expect(diff).toContain('[cut at 24000 characters]');
    expect(asked.state.plan).toEqual(['Change the key']);
    expect(asked.state.checks).toBe('No checks ran.');
  });

  it('accepts a verdict at confidence 0.8 or more and keeps the unmet requirements as reasons', () => {
    const reading = readVerdict(
      requirements,
      answered('unsupported', 0.93, { unmet_1: 0.91, unmet_2: 0.1 }),
    );
    expect(reading).toMatchObject({
      verdict: 'unsupported',
      accepted: 'unsupported',
      reasons: ['Return 0 when total is 0.'],
      invalid: [],
    });
    expect(
      readVerdict(requirements, answered('declined', 0.8, { unmet_1: 0, unmet_2: 0 })).accepted,
    ).toBe('declined');
  });

  it('counts an answer below 0.8 as not verified', () => {
    const reading = readVerdict(
      requirements,
      answered('unsupported', 0.79, { unmet_1: 0.6, unmet_2: 0 }),
    );
    expect(reading).toMatchObject({ verdict: 'unsupported', accepted: null });
  });

  it('rejects an unknown option, an out-of-range value or a missing answer', () => {
    expect(readVerdict(requirements, answered('maybe', 0.99)).invalid).toEqual([
      'verdict',
      'unmet_1',
      'unmet_2',
    ]);
    expect(readVerdict(requirements, answered('supported', 1.4)).accepted).toBeNull();
    const bad = readVerdict(
      requirements,
      answered('supported', 0.95, { unmet_1: 2, unmet_2: 0.1 }),
    );
    expect(bad).toMatchObject({ accepted: 'supported', invalid: ['unmet_1'] });
    expect(readVerdict(requirements, null)).toMatchObject({
      verdict: null,
      accepted: null,
      reasons: [],
    });
  });
});
