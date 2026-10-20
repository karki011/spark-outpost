import { describe, expect, it } from 'vitest';
import type { ConversationDetail } from '@spark-outpost/contracts';
import {
  agentsProgress,
  cardLine,
  finishedRows,
  INBOX_FINISHED,
  runningRows,
  shortAgo,
  stillAsking,
  answer,
  NONE_ANSWERED,
  topAnswerable,
} from './inbox-model.ts';
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
const NONE: ReadonlySet<string> = new Set();

describe('the top card that Y and N answer', () => {
  it('is the first loaded command or file request, never a question, plan or force-push', () => {
    const open = card('open');
    const question = card('question');
    const force = card('force');
    const loading = card('approval', { loading: true });
    const ready = card('approval');
    expect(topAnswerable([open, question, force, loading, ready])).toBe(ready);
    expect(topAnswerable([open, force])).toBeNull();
  });
});

describe('a request answered from the island', () => {
  it('stays gone until its chat changes, so it never flickers back as an open card', () => {
    const asked = card('approval');
    const answered = answer(NONE_ANSWERED, asked);
    expect(stillAsking([asked], answered)).toEqual([]);
    const stale = card('open', { chat: asked.chat });
    expect(stillAsking([stale], answered)).toEqual([]);
    const second = card('approval', { approval: approval({ id: 'second-approval' }) });
    expect(stillAsking([second], answered)).toEqual([second]);
    const changed = card('open', {
      chat: { ...asked.chat, updatedAt: '2026-10-20T10:07:00.000Z' },
    });
    expect(stillAsking([changed], answered)).toEqual([changed]);
  });
});

describe('what a card says', () => {
  it('names the command or the file, and hides secrets', () => {
    expect(cardLine(card('approval'))).toEqual({
      verb: 'Run',
      code: 'gh workflow run cd-alfa.yml',
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
    expect(cardLine(card('open')).text).toContain('feature-web-apps');
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
    expect(agentsProgress(rows[0]!.agents!)).toBeCloseTo(1 / 3);
  });
});

describe('finished rows', () => {
  it('shows unread successes and unseen failures until cleared, newest first and capped', () => {
    const done = chat(CHAT_A, {
      title: 'CP-49259 POC',
      unread: true,
      latestRun: run('succeeded', { finishedAt: '2026-10-20T10:04:00.000Z' }),
    });
    const failed = chat(CHAT_B, {
      title: 'Telemetry ingest',
      latestRun: run('failed', {
        finishedAt: '2026-10-20T10:05:00.000Z',
        error: 'terminal exited',
      }),
    });
    const read = chat('0c000000-0000-4000-8000-00000000000c', {
      latestRun: run('succeeded', { finishedAt: '2026-10-20T10:03:00.000Z' }),
    });
    const rows = finishedRows([done, failed, read], NONE);
    expect(rows.map((row) => [row.kind, row.chat.title, row.detail])).toEqual([
      ['failed', 'Telemetry ingest', 'failed: terminal exited'],
      ['done', 'CP-49259 POC', 'done'],
    ]);
    expect(finishedRows([done, failed], new Set([CHAT_B])).map((row) => row.kind)).toEqual([
      'done',
    ]);
    const many = Array.from({ length: 6 }, (_, index) =>
      chat(`0c000000-0000-4000-8000-00000000001${index}`, {
        unread: true,
        latestRun: run('succeeded'),
      }),
    );
    expect(finishedRows(many, NONE)).toHaveLength(INBOX_FINISHED);
  });
});

describe('short times', () => {
  it('reads now, minutes and hours', () => {
    expect(shortAgo('2026-10-20T10:05:30.000Z', NOW)).toBe('now');
    expect(shortAgo('2026-10-20T10:00:00.000Z', NOW)).toBe('6m');
    expect(shortAgo('2026-10-20T07:00:00.000Z', NOW)).toBe('3h');
  });
});
