import { describe, expect, it } from 'vitest';
import { mainAgentInstruction } from './instruction-turn.ts';

const DONE = {
  taskId: 'task-1',
  previousRequest: 'Fix the date parser',
  summary: 'Fixed it',
  lastReplyAt: new Date(),
};

describe('mainAgentInstruction()', () => {
  it.each(['open PR', 'open pr', 'dont use spark to open pr', 'push it', 'Create a pull request'])(
    'runs "%s" as the main agent once the work is done',
    (request) => {
      expect(mainAgentInstruction(request, DONE)).toBe(true);
    },
  );

  it.each([
    'add tests and open a PR',
    'fix the typo then push it',
    'Fix the date parser',
    "don't open a PR yet",
    `open a PR ${'with a long description '.repeat(10)}`,
  ])('keeps "%s" an orchestrated turn', (request) => {
    expect(mainAgentInstruction(request, DONE)).toBe(false);
  });

  it('orchestrates a first request even when it only asks for a PR', () => {
    expect(mainAgentInstruction('open pr', null)).toBe(false);
  });
});
