import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from './intake-questions.ts';
import { buildPolicyQuestions, editDiff, policyVerdict, POLICY_KEYS } from './policy-gate.ts';

const answered = (values: Record<string, number>): SystemOneResponse => ({
  model: 'jev-1.13.0',
  answers: Object.fromEntries(
    Object.entries(values).map(([key, noul]) => [key, { type: 'noul' as const, noul }]),
  ),
});

describe('policy gate questions', () => {
  it('sends the request, the target path and a real diff, with four bad-is-true nouls', () => {
    const diff = editDiff([
      { path: 'src/a.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n' },
    ]);
    expect(diff).toContain('-const a = 1;');
    expect(diff).toContain('+const a = 2;');
    const asked = buildPolicyQuestions({ request: 'Set a to 2', path: 'src/a.ts', diff });
    expect(asked.state).toEqual({ request: 'Set a to 2', path: 'src/a.ts', diff });
    expect(Object.keys(asked.questions)).toEqual([...POLICY_KEYS]);
    for (const question of Object.values(asked.questions)) {
      expect(Object.keys(question.criteria as object)).toEqual(['true', 'false']);
    }
  });

  it('redacts secrets in the diff and caps its size', () => {
    const diff = editDiff([
      {
        path: 'a.ts',
        oldText: null,
        newText: `const key = "sk-${'a'.repeat(40)}";\n${'x\n'.repeat(20_000)}`,
      },
    ]);
    expect(diff).not.toContain('sk-aaaa');
    expect(diff).toContain('[cut at 24000 characters]');
  });

  it('bounds the diff of a huge rewrite and still redacts what it shows', () => {
    const lines = (prefix: string) =>
      Array.from({ length: 60_000 }, (_, index) => `${prefix} ${index * 7919}`).join('\n');
    const started = performance.now();
    const diff = editDiff([
      {
        path: 'big.ts',
        oldText: `TOKEN=ghp_${'b1'.repeat(15)}\n${lines('old')}`,
        newText: lines('new'),
      },
    ]);
    expect(performance.now() - started).toBeLessThan(500);
    expect(diff.length).toBeLessThan(24_100);
    expect(diff).toContain('[cut at 24000 characters]');
    expect(diff).toContain('-TOKEN=[redacted:');
    expect(diff).not.toContain('ghp_b1');
  });
});

describe('policy verdict', () => {
  it('takes the max of the violation probabilities', () => {
    expect(
      policyVerdict(
        answered({
          beyond_request: 0.1,
          destroys_work: 0.9,
          weakens_tests: 0.2,
          unsupported_file: 0.1,
        }),
      ),
    ).toMatchObject({ max: 0.9, action: 'block', invalid: [] });
    expect(
      policyVerdict(
        answered({
          beyond_request: 0.6,
          destroys_work: 0.1,
          weakens_tests: 0.2,
          unsupported_file: 0.1,
        }),
      ).action,
    ).toBe('review');
    expect(
      policyVerdict(
        answered({
          beyond_request: 0.1,
          destroys_work: 0.1,
          weakens_tests: 0.2,
          unsupported_file: 0.1,
        }),
      ).action,
    ).toBe('allow');
  });

  it('treats a missing or invalid judgment as review, never allow', () => {
    expect(policyVerdict(null)).toMatchObject({ action: 'review', max: null });
    const partial = policyVerdict(
      answered({
        beyond_request: 0.1,
        destroys_work: 0.1,
        weakens_tests: 2,
        unsupported_file: 0.1,
      }),
    );
    expect(partial).toMatchObject({ action: 'review', invalid: ['weakens_tests'] });
  });
});
