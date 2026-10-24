import { ANSWERED_BY_ASK_SPARK, type Approval } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { cardsLeft, commandAnswers } from './command-answers.ts';

const decidedAt = new Date(2026, 9, 23, 16, 58).toISOString();

function approval(toolCallId: string, extra: Partial<Approval> = {}): Approval {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    runId: '00000000-0000-4000-8000-000000000002',
    toolCallId,
    kind: 'execute',
    title: 'pnpm test',
    payload: { command: 'pnpm test', cwd: null, paths: [], diffs: [], truncated: false },
    payloadHash: 'hash',
    options: [],
    status: 'allowed',
    reason: null,
    decisionOptionId: 'allow',
    scope: 'once',
    decidedBy: 'user',
    decidedAt,
    createdAt: decidedAt,
    ...extra,
  };
}

describe('commandAnswers', () => {
  it('says how and when a card for the command was answered', () => {
    const answers = commandAnswers(
      [
        approval('a'),
        approval('b', { scope: 'run' }),
        approval('c', { scope: 'chat' }),
        approval('d', { scope: 'project' }),
        approval('e', { note: ANSWERED_BY_ASK_SPARK }),
      ],
      'h23',
    );
    expect([...answers].map(([id, answer]) => [id, answer.line])).toEqual([
      ['a', 'You allowed it once · 16:58'],
      ['b', 'You allowed it for this run · 16:58'],
      ['c', 'You allowed it for this chat · 16:58'],
      ['d', 'You always allow it in this project · 16:58'],
      ['e', 'Ask Spark allowed it once · 16:58'],
    ]);
    expect(commandAnswers([approval('a')], 'h12').get('a')?.line).toBe(
      'You allowed it once · 4:58 PM',
    );
    expect(commandAnswers([approval('f', { status: 'denied' })], 'h23').get('f')).toEqual({
      line: 'You denied it · 16:58',
      denied: true,
    });
  });

  it('says nothing when no one answered a command card', () => {
    const answers = commandAnswers(
      [
        approval('mode', { decidedBy: 'level' }),
        approval('list', { decidedBy: 'allowlist' }),
        approval('expired', { status: 'expired', decidedBy: 'timeout' }),
        approval('edit', { kind: 'edit' }),
        approval('waiting', { status: 'pending', decidedBy: null, decidedAt: null }),
      ],
      'h23',
    );
    expect(answers.size).toBe(0);
  });

  it('folds only answered command cards whose command is in the turn', () => {
    const cards = [
      approval('ran'),
      approval('never-ran'),
      approval('edit', { kind: 'edit' }),
      approval('mode', { decidedBy: 'level' }),
    ];
    const answers = commandAnswers(cards, 'h23');
    const left = cardsLeft(cards, answers, new Set(['ran', 'edit', 'mode']));
    expect(left.map((card) => card.toolCallId)).toEqual(['never-ran', 'edit', 'mode']);
  });
});
