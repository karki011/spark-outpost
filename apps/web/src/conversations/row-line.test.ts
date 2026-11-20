import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { finishedAt, rowLine, waitingAge } from './row-line.ts';
import { rowState } from './row-state.ts';

vi.mock('../desktop/hour-cycle.ts', () => ({ hourCycle: () => 'h23' }));

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Chat',
    updatedAt: '2026-11-18T10:00:00.000Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...overrides,
  };
}

const run = (status: string, extra: Record<string, unknown> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000002',
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    ...extra,
  }) as ConversationSummary['latestRun'];

const lineOf = (summary: ConversationSummary) => rowLine(summary, rowState(summary, false));
const at = (time: string) => new Date(`2026-11-18T${time}`).getTime();

describe('rowLine', () => {
  it('says what a working chat is doing, but not a bare Working', () => {
    const planned = chat({ latestRun: run('running', { doing: 'Run the browser specs' }) });
    expect(lineOf(planned)).toEqual({ kind: 'doing', text: 'Run the browser specs' });
    expect(lineOf(chat({ latestRun: run('running') }))).toBeNull();
  });

  it('times how long a chat has waited for you', () => {
    const waiting = chat({
      needsInput: true,
      waitingSince: '2026-11-18T09:57:00.000Z',
      latestRun: run('awaiting_approval'),
    });
    expect(lineOf(waiting)).toEqual({ kind: 'waiting', since: Date.parse(waiting.waitingSince!) });
  });

  it('shows when an unread turn finished, and nothing once it is read', () => {
    const finished = chat({
      unread: true,
      latestRun: run('succeeded', { finishedAt: '2026-11-18T09:41:00.000Z' }),
    });
    expect(lineOf(finished)).toEqual({ kind: 'finished', at: Date.parse('2026-11-18T09:41:00Z') });
    expect(lineOf({ ...finished, unread: false })).toBeNull();
  });

  it('gives a flag or a shell alert no finished line', () => {
    const latestRun = run('succeeded', { finishedAt: '2026-11-18T09:41:00.000Z' });
    const flag = {
      kind: 'flag',
      title: 'Sent data after reading',
    } as ConversationSummary['attention'];
    expect(lineOf(chat({ attention: flag, latestRun }))).toBeNull();
    expect(lineOf(chat({ shellAlert: 'Build failed', latestRun }))).toBeNull();
  });

  it('leaves idle and terminal rows to one line', () => {
    expect(lineOf(chat())).toBeNull();
    const terminal = chat({
      sessionType: 'terminal',
      terminal: { state: 'working', updatedAt: '2026-11-18T09:00:00.000Z' },
    } as Partial<ConversationSummary>);
    expect(lineOf(terminal)).toBeNull();
  });
});

describe('row line text', () => {
  it('counts the wait in minutes, hours and days', () => {
    const since = at('10:00:00');
    expect(waitingAge(since, since + 30_000)).toBe('Waiting under a minute');
    expect(waitingAge(since, since + 3 * 60_000)).toBe('Waiting 3m');
    expect(waitingAge(since, since + 65 * 60_000)).toBe('Waiting 1h 5m');
    expect(waitingAge(since, since + 120 * 60_000)).toBe('Waiting 2h');
    expect(waitingAge(since, since + 50 * 3_600_000)).toBe('Waiting 2d');
  });

  it('gives the finish time in the Mac clock, with the day when it was not today', () => {
    expect(finishedAt(at('14:32:00'), at('15:00:00'))).toBe('Finished 14:32');
    expect(finishedAt(at('14:32:00') - 86_400_000, at('15:00:00'))).toBe(
      'Finished yesterday, 14:32',
    );
    expect(finishedAt(at('14:32:00') - 3 * 86_400_000, at('15:00:00'))).toBe('Finished 3d ago');
  });
});
