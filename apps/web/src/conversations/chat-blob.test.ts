import { describe, expect, it } from 'vitest';
import type { ConversationSummary, NativeTerminalSession } from '@spark-outpost/contracts';
import { chatBlob, unseenSince } from './chat-blob.ts';

const BEFORE = '2026-10-15T09:00:00.000Z';
const SEEN = '2026-10-15T10:00:00.000Z';
const AFTER = '2026-10-15T11:00:00.000Z';

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Chat',
    updatedAt: BEFORE,
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
    seenAt: SEEN,
    ...overrides,
  };
}

function run(status: string, finishedAt: string | null, needsYou: string | null = null) {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    status,
    error: status === 'failed' ? 'Rate limit reached.' : null,
    step: null,
    provider: null,
    progress: null,
    needsYou,
    finishedAt,
  } as ConversationSummary['latestRun'];
}

function finished(finishedAt: string, seenAt: string | null = SEEN) {
  const unread = seenAt === null || finishedAt > seenAt;
  return chat({ latestRun: run('succeeded', finishedAt), unread, seenAt });
}

function waiting(since: string) {
  return chat({
    latestRun: run('awaiting_approval', null),
    needsInput: true,
    waitingSince: since,
    attention: {
      kind: 'permission',
      title: 'run pnpm test',
      agentName: null,
      provider: 'claude',
      approvalId: '00000000-0000-4000-8000-000000000003',
    },
  });
}

function terminal(
  state: NativeTerminalSession['state'],
  updatedAt: string,
  extra: Partial<ConversationSummary> = {},
) {
  return chat({
    sessionType: 'terminal',
    terminal: {
      id: '00000000-0000-4000-8000-000000000004',
      conversationId: '00000000-0000-4000-8000-000000000001',
      provider: 'claude',
      state,
      cwd: '/work',
      label: 'Claude Code',
      updatedAt,
      resumeAvailable: true,
      runId: null,
      observation: 'hooks',
      reason: null,
      agentMode: null,
    },
    ...extra,
  });
}

describe('chatBlob', () => {
  it('shows working while a turn runs, whenever it started', () => {
    expect(chatBlob(chat({ latestRun: run('running', null) }), false)).toBe('working');
    expect(chatBlob(chat({ latestRun: run('queued', null), seenAt: AFTER }), false)).toBe(
      'working',
    );
  });

  it('shows done only when the turn finished after the chat was last seen', () => {
    expect(chatBlob(finished(AFTER), false)).toBe('done');
    expect(chatBlob(finished(BEFORE), false)).toBeNull();
    expect(chatBlob(finished(AFTER, null), false)).toBe('done');
  });

  it('shows waiting for a card raised after the chat was seen, and not one seen already', () => {
    expect(chatBlob(waiting(AFTER), false)).toBe('waiting');
    expect(chatBlob(waiting(BEFORE), false)).toBeNull();
  });

  it('treats a finished reply that asks you something as waiting', () => {
    const asking = chat({
      latestRun: run('succeeded', AFTER, 'Pick a name'),
      unread: true,
    });
    expect(chatBlob(asking, false)).toBe('waiting');
  });

  it('shows failed for an error or an interrupted turn after the chat was seen', () => {
    expect(chatBlob(chat({ latestRun: run('failed', AFTER) }), false)).toBe('failed');
    expect(chatBlob(chat({ latestRun: run('failed', BEFORE) }), false)).toBeNull();
    expect(chatBlob(chat({ latestRun: run('outcome_unknown', AFTER) }), false)).toBe('failed');
  });

  it('never shows a blob on the chat that is open', () => {
    expect(chatBlob(chat({ latestRun: run('running', null) }), true)).toBeNull();
    expect(chatBlob(finished(AFTER), true)).toBeNull();
    expect(chatBlob(waiting(AFTER), true)).toBeNull();
  });

  it('shows a blob again when the state changes after the chat was seen', () => {
    const seenDone = finished(SEEN, AFTER);
    expect(chatBlob(seenDone, false)).toBeNull();
    const later = '2026-10-15T12:00:00.000Z';
    expect(chatBlob({ ...seenDone, latestRun: run('failed', later) }, false)).toBe('failed');
  });

  it('covers Terminal sessions: working, waiting for input, a finished turn and a crash', () => {
    expect(chatBlob(terminal('working', BEFORE), false)).toBe('working');
    expect(
      chatBlob(
        terminal('waiting_for_input', AFTER, { needsInput: true, waitingSince: AFTER }),
        false,
      ),
    ).toBe('waiting');
    expect(
      chatBlob(
        terminal('waiting_for_input', BEFORE, { needsInput: true, waitingSince: BEFORE }),
        false,
      ),
    ).toBeNull();
    expect(chatBlob(terminal('ready', AFTER, { latestRun: run('succeeded', AFTER) }), false)).toBe(
      'done',
    );
    expect(
      chatBlob(terminal('ready', AFTER, { latestRun: run('succeeded', BEFORE) }), false),
    ).toBeNull();
    expect(chatBlob(terminal('error', AFTER), false)).toBe('failed');
    expect(chatBlob(terminal('exited', AFTER), false)).toBeNull();
  });
});

describe('unseenSince', () => {
  it('gives the time the unseen state began, so opening the chat can mark it seen', () => {
    expect(unseenSince(finished(AFTER))).toBe(AFTER);
    expect(unseenSince(waiting(AFTER))).toBe(AFTER);
  });

  it('has nothing to mark for a running turn or a state already seen', () => {
    expect(unseenSince(chat({ latestRun: run('running', null) }))).toBeNull();
    expect(unseenSince(finished(BEFORE))).toBeNull();
  });
});
