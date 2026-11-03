import { describe, expect, it } from 'vitest';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { askedQuestions } from './ReplyOptions.tsx';

const question = {
  question: 'Which store?',
  options: ['Postgres', 'SQLite'],
  default: 'Postgres',
  pick: 'one' as const,
  freeText: true,
};

describe('askedQuestions', () => {
  it('sees an agent question card, answered or waiting', () => {
    expect(askedQuestions([checkpoint({ kind: 'clarify', questions: [question] })])).toBe(true);
    expect(
      askedQuestions([checkpoint({ kind: 'clarify', questions: [] }, { status: 'allowed' })]),
    ).toBe(true);
  });

  it('ignores other cards', () => {
    expect(askedQuestions([checkpoint({ kind: 'accept' })])).toBe(false);
    expect(askedQuestions([])).toBe(false);
  });
});
