import { describe, expect, it } from 'vitest';
import type {
  AgentModeOption,
  ConversationDetail,
  ConversationSummary,
} from '@spark-outpost/contracts';
import { pagerLabel, sessionFacts, sessionNotes, showsFacts } from './session-summary.ts';

const RUN = '00000000-0000-4000-8000-000000000001';

function chat(patch: Partial<ConversationSummary> = {}) {
  return {
    id: 'chat',
    title: 'Fix billing totals',
    updatedAt: '2026-10-02T12:00:00.000Z',
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
    ...patch,
  } satisfies ConversationSummary;
}

const run = (status: string, patch: object = {}) =>
  ({
    id: RUN,
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    ...patch,
  }) as ConversationSummary['latestRun'];

const detail = (reply: string | null, agentMode: string | null = null) =>
  ({
    messages: reply ? [{ role: 'assistant', runId: RUN, content: reply }] : [],
    settings: { agentMode },
  }) as unknown as ConversationDetail;

function terminal(state: string, updatedAt = '2026-10-02T12:30:00.000Z') {
  return chat({
    sessionType: 'terminal',
    terminal: {
      id: RUN,
      conversationId: RUN,
      provider: 'claude',
      state,
      cwd: '/Users/ada/code/feature-web-apps',
      label: 'my files · feature-web-apps',
      updatedAt,
      resumeAvailable: false,
      runId: null,
      observation: 'hooks',
      reason: null,
    } as NonNullable<ConversationSummary['terminal']>,
  });
}

const MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'plan', label: 'Plan' },
] as AgentModeOption[];

describe('what a session card says', () => {
  it('shows the last reply of a finished or quiet chat, with or without steps above it', () => {
    const done = chat({ latestRun: run('succeeded') });
    const said = detail('Totals now round **half up**. Tests pass.');
    expect(sessionNotes(done, 'done', said, false)).toEqual([
      { tone: 'said', lead: 'Finished: ', text: 'Totals now round half up.' },
    ]);
    expect(sessionNotes(done, 'done', said, true)).toHaveLength(1);
    const stopped = chat({ latestRun: run('cancelled') });
    expect(sessionNotes(stopped, 'idle', said, false)[0]).toMatchObject({ lead: 'Last reply: ' });
  });

  it('falls back to one plain word only when there is nothing else to show', () => {
    expect(sessionNotes(chat(), 'idle', detail(null), false)).toEqual([
      { tone: 'plain', lead: null, text: 'Quiet' },
    ]);
    expect(sessionNotes(chat(), 'idle', detail(null), true)).toEqual([]);
    expect(sessionNotes(terminal('ready'), 'idle', undefined, false)[0]?.text).toBe('Idle');
    const starting = chat({ latestRun: run('queued') });
    expect(sessionNotes(starting, 'working', undefined, false)[0]?.text).toBe('Starting');
    expect(sessionNotes(starting, 'working', undefined, true)).toEqual([]);
  });

  it('says what a waiting session waits for, also under its steps', () => {
    const asking = chat({
      needsInput: true,
      latestRun: run('awaiting_approval'),
      attention: {
        kind: 'permission',
        title: 'run pnpm deploy',
        agentName: null,
        provider: 'claude',
        approvalId: RUN,
      },
    });
    expect(sessionNotes(asking, 'waiting', undefined, true)).toEqual([
      { tone: 'wait', lead: 'Waiting: ', text: 'Claude wants to run pnpm deploy' },
    ]);
    expect(sessionNotes(terminal('waiting_for_input'), 'waiting', undefined, false)[0]?.text).toBe(
      'Waiting for input',
    );
  });

  it('puts what a finished turn needs from you before its reply, and a failure reason alone', () => {
    const needs = chat({
      unread: true,
      latestRun: run('succeeded', { needsYou: 'Pick a rounding rule' }),
    });
    expect(sessionNotes(needs, 'done', detail('Done.'), false).map((note) => note.tone)).toEqual([
      'wait',
      'said',
    ]);
    const failed = chat({ latestRun: run('failed', { error: 'Tests failed.' }) });
    expect(sessionNotes(failed, 'failed', detail('Half done.'), false)).toEqual([
      { tone: 'bad', lead: null, text: 'Stopped: tests failed' },
    ]);
  });
});

describe('the facts under a session', () => {
  const names = new Map([['p1', 'feature-web-apps']]);

  it('names the project and branch of a chat and leaves out what is unknown', () => {
    const linked = chat({ projectIds: ['gone', 'p1'], branch: 'spark/fix-billing' });
    expect(sessionFacts(linked, undefined, names, [])).toEqual({
      terminal: false,
      parts: ['feature-web-apps', 'spark/fix-billing'],
      changedAt: '2026-10-02T12:00:00.000Z',
    });
    expect(sessionFacts(chat({ branch: null }), undefined, names, []).parts).toEqual([]);
    expect(sessionFacts(linked, undefined, names, [], 'Claude · Opus').parts[0]).toBe(
      'Claude · Opus',
    );
  });

  it('names a Terminal session by its mode and folder, and by when its state last changed', () => {
    const facts = sessionFacts(terminal('ready'), detail(null, 'auto'), names, MODES);
    expect(facts).toEqual({
      terminal: true,
      parts: ['Auto', 'feature-web-apps'],
      changedAt: '2026-10-02T12:30:00.000Z',
    });
    expect(sessionFacts(terminal('ready'), detail(null, 'secret'), names, MODES).parts).toEqual([
      'feature-web-apps',
    ]);
    const older = terminal('ready', '2026-10-01T00:00:00.000Z');
    expect(sessionFacts(older, undefined, names, MODES).changedAt).toBe('2026-10-02T12:00:00.000Z');
  });

  it('stays out of the way only while live steps fill the card', () => {
    expect(showsFacts('working', true)).toBe(false);
    expect(showsFacts('working', false)).toBe(true);
    expect(showsFacts('done', true)).toBe(true);
    expect(pagerLabel(1, 3)).toBe('2 of 3');
  });
});
