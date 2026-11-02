import { describe, expect, it } from 'vitest';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { cardLine, runningRows, shortAgo } from './inbox-model.ts';
import {
  approval,
  card,
  chat,
  CHAT_A,
  CHAT_B,
  run,
  RUN_A,
  subagent,
} from './inbox-test-fixtures.ts';

const NOW = Date.parse('2026-10-20T10:06:00.000Z');

describe('what a card says', () => {
  it('names the command or the file, and hides secrets', () => {
    expect(cardLine(card('approval'))).toEqual({
      verb: 'Run',
      code: 'gh workflow run cd-staging.yml',
      text: null,
    });
    const edit = card('approval', {
      approval: approval({
        kind: 'edit',
        payload: { command: null, cwd: null, paths: ['src/a.ts'], diffs: [], truncated: false },
      }),
    });
    expect(cardLine(edit)).toMatchObject({ verb: 'Change', code: 'src/a.ts' });
    const secret = card('approval', {
      approval: approval({
        payload: {
          command: 'curl -H "Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"',
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
        },
      }),
    });
    expect(cardLine(secret).code).not.toContain('sk-ant-abcdefghijklmnop');
  });

  it('gives a plan or open request a plain line to answer in Spark', () => {
    expect(cardLine(card('open'))).toMatchObject({ verb: null, code: null });
    expect(cardLine(card('open')).text).toContain('orders-web-app');
  });
});

describe('running rows', () => {
  it('lists working chats newest first with their step, and sub-agents as a count and bar', () => {
    const working = chat(CHAT_A, {
      title: 'Ticket tree data',
      latestRun: run('running'),
      updatedAt: '2026-10-20T10:05:00.000Z',
    });
    const testing = chat(CHAT_B, {
      title: 'Cloudsmith setup',
      latestRun: run('running', { step: 'running tests', id: CHAT_B }),
    });
    const idle = chat('0c000000-0000-4000-8000-00000000000c', { latestRun: run('succeeded') });
    const detail = {
      subagents: {
        [RUN_A]: [subagent('1', 'working'), subagent('2', 'working'), subagent('3', 'done')],
      },
    } as unknown as ConversationDetail;
    const rows = runningRows([testing, working, idle], new Map([[CHAT_A, detail]]));
    expect(rows.map((row) => [row.chat.title, row.detail])).toEqual([
      ['Ticket tree data', '2 of 3 agents working'],
      ['Cloudsmith setup', 'running tests'],
    ]);
  });
});

describe('short times', () => {
  it('reads now, minutes and hours', () => {
    expect(shortAgo('2026-10-20T10:05:30.000Z', NOW)).toBe('now');
    expect(shortAgo('2026-10-20T10:00:00.000Z', NOW)).toBe('6m');
    expect(shortAgo('2026-10-20T07:00:00.000Z', NOW)).toBe('3h');
  });
});
