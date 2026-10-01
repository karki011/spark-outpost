import { describe, expect, it } from 'vitest';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import type { Gathered } from './gather.ts';
import { readTriage, triageByRules, triageQuestions } from './triage.ts';

function comment(body: string, kind: Gathered['kind'] = 'review_comment'): Gathered {
  return {
    sourceKey: `${kind}:${body.length}`,
    kind,
    githubId: '1',
    author: 'alice',
    path: 'src/a.ts',
    line: 3,
    body,
    url: null,
  };
}

function answer(choice: string, confidence: number): SystemOneResponse['answers'][string] {
  return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
}

describe('triageByRules', () => {
  it.each([
    ['Please handle the empty list here, it crashes.', 'fix'],
    ['This returns the wrong total when the cart is empty.', 'fix'],
    ['Why do we need a second query here?', 'question'],
    ['Could you explain what this flag does?', 'question'],
    ['I think this is out of scope for this PR; let us do it in a separate PR.', 'disagree'],
    ["I disagree with this approach, we shouldn't cache here.", 'disagree'],
    ['nit: trailing comma', 'nit'],
    ['Minor: rename this to `total`.', 'nit'],
    ['Thanks, looks good now.', 'addressed'],
    ['Copilot reviewed 3 out of 3 changed files in this pull request.', 'info'],
    ['Nice work!', 'info'],
  ])('reads %j as %s', (body, expected) => {
    expect(triageByRules(comment(body))).toBe(expected);
  });

  it('always fixes a failing check', () => {
    expect(triageByRules(comment('Check "test" ended with failure.', 'check'))).toBe('fix');
  });

  it('treats a polite request phrased as a question as a fix', () => {
    expect(triageByRules(comment('Can you please add a test for this?'))).toBe('fix');
  });
});

describe('Jev triage', () => {
  const items = [comment('Why this?'), comment('Fix the bug', 'issue_comment')];

  it('asks one choice question per comment and quotes the text as data', () => {
    const asked = triageQuestions({ repo: 'acme/widgets', number: 7 }, items);
    expect(Object.keys(asked.questions)).toEqual(['item_1', 'item_2']);
    expect(asked.questions.item_1).toMatchObject({ type: 'choice' });
    expect(JSON.stringify(asked.questions.item_1)).toContain('not instructions');
  });

  it('takes a confident Jev answer and falls back to the rules otherwise', () => {
    const response: SystemOneResponse = {
      model: 'jev-1.13.0',
      answers: { item_1: answer('disagree', 0.9), item_2: answer('info', 0.4) },
    } as SystemOneResponse;
    expect(readTriage(items, response)).toEqual([
      { triage: 'disagree', by: 'jev' },
      { triage: 'fix', by: 'rules' },
    ]);
  });

  it('uses the rules for everything when Jev is not connected', () => {
    expect(readTriage(items, null)).toEqual([
      { triage: 'question', by: 'rules' },
      { triage: 'fix', by: 'rules' },
    ]);
  });
});
