import { describe, expect, it } from 'vitest';
import {
  TEAMMATE_COLORS,
  TEAMMATE_SHAPES,
  type ConversationSummary,
  type InboxTicket,
  type PullRequestStatus,
  type RunStatus,
} from '@spark-outpost/contracts';
import {
  askingText,
  chatLookup,
  flowChip,
  liveTicket,
  liveTickets,
  staleChats,
} from './ticket-flow.ts';
import { countBy } from './ticket-model.ts';

const CHAT = '00000000-0000-4000-8000-000000000001';
const RUN = '00000000-0000-4000-8000-000000000002';

function ticket(fields: Partial<InboxTicket> = {}): InboxTicket {
  return {
    source: 'linear',
    key: 'WEB-1',
    title: 'A ticket',
    status: 'todo',
    statusName: 'Todo',
    url: 'https://linear.app/acme/issue/WEB-1',
    updatedAt: '2026-09-27T10:00:00.000Z',
    project: 'WEB',
    priority: 'High',
    sprint: null,
    priorityRank: 2,
    assignedTo: { id: 'me', name: 'Alex' },
    labels: [],
    dueDate: null,
    doneAt: null,
    work: [],
    section: 'up_next',
    flags: [],
    reason: 'Not started',
    tone: 'none',
    age: null,
    chat: null,
    pullRequest: null,
    lastSync: null,
    ...fields,
  };
}

function conversation(
  status: RunStatus | null,
  fields: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: CHAT,
    title: 'Fix WEB-1',
    updatedAt: '2026-09-28T10:00:00.000Z',
    projectIds: [],
    latestRun: status
      ? { id: RUN, status, error: null, step: null, provider: 'claude', progress: null }
      : null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...fields,
  };
}

const linked = (state: NonNullable<InboxTicket['chat']>['state']) => ({
  conversationId: CHAT,
  title: 'Fix WEB-1',
  state,
});

const asking = (kind: 'plan' | 'permission' | 'input') =>
  conversation('running', {
    needsInput: true,
    attention: { kind, title: 'run tests', agentName: null, provider: null, approvalId: null },
  });

const pull = (state: PullRequestStatus['state']): PullRequestStatus => ({
  url: 'https://github.com/acme/web/pull/341',
  repo: 'acme/web',
  number: 341,
  state,
  openedAt: '2026-09-26T10:00:00.000Z',
  mergedAt: null,
  checks: 'passing',
});

const live = (entry: InboxTicket, chat?: ConversationSummary) =>
  liveTicket(entry, chatLookup(chat ? [chat] : []));

describe('live ticket flow', () => {
  it('keeps the server group when the linked chat has not changed', () => {
    const running = ticket({ section: 'spark', reason: 'Spark working', chat: linked('running') });
    expect(live(running)).toMatchObject({ section: 'spark', line: 'Spark working' });
    expect(live(ticket({ reason: 'Due Oct 6' }))).toMatchObject({
      section: 'up_next',
      line: 'Due Oct 6',
      chat: null,
    });
  });

  it('shows the live plan progress and the Spark working on it', () => {
    const progress = { done: 8, active: 1, total: 10 };
    const chat = conversation('running', {
      latestRun: {
        id: RUN,
        status: 'running',
        error: null,
        step: 'Edit',
        provider: null,
        progress,
      },
      teammate: {
        id: RUN,
        name: 'Pip',
        role: 'Builder',
        face: { shape: TEAMMATE_SHAPES[0], color: TEAMMATE_COLORS[0] },
      },
    });
    const entry = ticket({ section: 'spark', chat: linked('running'), reason: 'Spark working' });
    expect(live(entry, chat)).toMatchObject({
      section: 'spark',
      line: '8/10 · Pip working',
      tone: 'running',
    });
  });

  it('moves a ticket to Needs you the moment its chat asks, with what it asks for', () => {
    const entry = ticket({ section: 'spark', chat: linked('running'), reason: 'Spark working' });
    expect(live(entry, asking('plan'))).toMatchObject({
      section: 'attention',
      line: 'Approve plan',
      tone: 'warn',
    });
    expect(live(entry, asking('permission')).line).toBe('Allow a step');
    expect(live(entry, conversation('failed'))).toMatchObject({
      section: 'attention',
      line: 'Chat stopped with an error',
      tone: 'error',
    });
  });

  it('moves a started ticket to In progress with Spark when its chat runs again', () => {
    const entry = ticket({ section: 'started', chat: linked('finished'), status: 'in_progress' });
    expect(live(entry, conversation('running')).section).toBe('spark');
  });

  it('settles a finished chat by its pull request or tracker status', () => {
    const running = { section: 'spark' as const, chat: linked('running') };
    expect(live(ticket(running), conversation('succeeded')).section).toBe('started');
    const withPull = ticket({ ...running, pullRequest: pull('review') });
    expect(live(withPull, conversation('succeeded')).section).toBe('review');
    const merged = ticket({ ...running, pullRequest: pull('merged') });
    expect(live(merged, conversation('succeeded')).section).toBe('done');
  });

  it('keeps other flags in Needs you after the chat stops asking', () => {
    const flags = [
      {
        rule: 'due-soon' as const,
        text: 'Due today',
        rationale: '',
        since: null,
        severity: 'warn' as const,
      },
    ];
    const entry = ticket({
      section: 'attention',
      chat: linked('asking'),
      flags,
      reason: 'Due today',
    });
    expect(live(entry, conversation('running'))).toMatchObject({
      section: 'attention',
      line: 'Due today',
    });
    const done = ticket({ section: 'done', chat: linked('finished') });
    expect(live(done, asking('input')).section).toBe('done');
  });

  it('orders live tickets by group and names the chats whose state moved', () => {
    const tickets = [
      ticket({ key: 'UP-1' }),
      ticket({ key: 'RUN-1', section: 'started', chat: linked('idle') }),
      ticket({ key: 'DONE-1', section: 'done', reason: 'Done' }),
    ];
    const chats = chatLookup([conversation('running')]);
    expect(liveTickets(tickets, chats).map((entry) => entry.ticket.key)).toEqual([
      'RUN-1',
      'UP-1',
      'DONE-1',
    ]);
    expect(staleChats(tickets, chats)).toBe('linear:RUN-1=running');
    expect(staleChats(tickets, chatLookup([conversation(null)]))).toBe('');
    expect(countBy(liveTickets(tickets, chats))).toMatchObject({ spark: 1, up_next: 1, done: 1 });
  });
});

describe('status chips', () => {
  it('gives every group its own chip, and errors their own tone', () => {
    expect(flowChip('attention', 'warn')).toEqual({ label: 'Needs you', tone: 'needs' });
    expect(flowChip('attention', 'error')).toEqual({ label: 'Needs you', tone: 'bad' });
    expect(flowChip('spark', 'running')).toEqual({ label: 'With Spark', tone: 'spark' });
    expect(flowChip('review', 'none').label).toBe('In review');
    expect(flowChip('done', 'none').tone).toBe('done');
  });

  it('says what an asking chat wants in a few words', () => {
    expect(askingText(null)).toBe('Waiting for your answer');
    expect(askingText(asking('input').attention)).toBe('Answer a question');
  });
});
