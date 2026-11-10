import { describe, expect, it } from 'vitest';
import type { ConversationSummary, Digest, DigestBody } from '@spark-outpost/contracts';
import { needsYou } from './home-model.ts';
import { briefEntries, feedRows, ticketEntries, ticketKeyOf, writingMeta } from './needs-model.ts';

const NOW = Date.parse('2026-09-29T10:00:00.000Z');
let next = 0;

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    title: `Chat ${next}`,
    updatedAt: '2026-09-29T09:40:00.000Z',
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

function run(status: string, error: string | null = null) {
  return {
    id: '00000000-0000-4000-8000-00000000aaaa',
    status,
    error,
    step: null,
    provider: 'claude',
    progress: null,
  } as ConversationSummary['latestRun'];
}

function digest(body: Partial<DigestBody>, overrides: Partial<Digest> = {}): Digest {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'ready',
    createdAt: '2026-09-29T09:12:00.000Z',
    finishedAt: '2026-09-29T09:12:30.000Z',
    since: '2026-09-28T09:12:00.000Z',
    body: {
      headline: 'Two things.',
      lines: [],
      suggestions: [],
      items: [],
      structured: true,
      ...body,
    },
    error: null,
    provider: 'claude',
    modelLabel: 'Sonnet 5',
    costUsd: 0.01,
    costSource: 'reported',
    conversationId: null,
    stats: { finished: 0, waiting: 0, failedOrStalled: 0, costUsd: null },
    ...overrides,
  };
}

const asking = chat({ title: 'Fix login redirect', needsInput: true });
const stopped = chat({ title: 'Migrate billing', latestRun: run('failed', 'Rate limit reached.') });
const finished = chat({ title: 'Dark mode tokens', latestRun: run('succeeded'), unread: true });
const idle = chat({ title: 'Webhook signer', latestRun: run('succeeded') });
const titles = new Map([['ticket:linear:WEB-433', 'Session expires during uploads']]);
const titleOf = (id: string) => titles.get(id) ?? null;

describe('feedRows', () => {
  it('turns each flagged chat into a lean row with a severity, a compact age and one action', () => {
    const rows = feedRows(needsYou([finished, stopped, asking, idle]), NOW);
    expect(
      rows.map((row) => [row.item.chat.title, row.severity, row.item.action, row.primary]),
    ).toEqual([
      ['Fix login redirect', 'warn', 'Answer', true],
      ['Migrate billing', 'bad', 'See error', false],
      ['Dark mode tokens', 'done', 'Review', false],
    ]);
    expect(rows[1]).toMatchObject({ age: '20m', ageTitle: 'Updated 20 min ago' });
    expect(rows[1]!.item.sub).toBe('Stopped: rate limit reached');
  });
});

describe('briefEntries', () => {
  const body = {
    suggestions: [
      { chatId: idle.id, reason: 'The README section is drafted.', draft: 'Write the README.' },
      { chatId: asking.id, reason: 'Needs a yes or no.', draft: 'Keep the cookie.' },
    ],
    items: [
      { itemId: 'ticket:linear:WEB-433', text: 'Urgent and due tomorrow.' },
      { itemId: 'chat:unknown', text: 'Not a ticket.' },
    ],
  };

  it('puts chats waiting on you first, then tickets, then chats to continue', () => {
    const entries = briefEntries(digest(body), [asking, idle], titleOf);
    expect(entries.map((entry) => [entry.verb, entry.key, entry.title, entry.text])).toEqual([
      ['Answer', null, 'Fix login redirect', 'Needs a yes or no.'],
      ['Open', 'WEB-433', 'Session expires during uploads', 'Urgent and due tomorrow.'],
      ['Continue', null, 'Webhook signer', 'The README section is drafted.'],
    ]);
  });

  it('answers without a draft and continues with the drafted message', () => {
    const [answer, , resume] = briefEntries(digest(body), [asking, idle], titleOf);
    expect(answer!.target).toMatchObject({ kind: 'chat', draft: null });
    expect(resume!.target).toMatchObject({ kind: 'chat', draft: 'Write the README.' });
  });

  it('drops chats that are gone or archived and keeps at most three items', () => {
    const archived = { ...idle, archivedAt: '2026-09-29T09:00:00.000Z' };
    expect(briefEntries(digest(body), [asking, archived], titleOf)).toHaveLength(2);
    const many = {
      items: ['A-1', 'A-2', 'A-3', 'A-4'].map((key) => ({
        itemId: `ticket:jira:${key}`,
        text: `Handle ${key}.`,
      })),
    };
    expect(briefEntries(digest(many), [], titleOf).map((entry) => entry.key)).toEqual([
      'A-1',
      'A-2',
      'A-3',
    ]);
  });

  it('shows nothing while the brief is writing or after it failed', () => {
    expect(briefEntries(digest(body, { status: 'running' }), [asking], titleOf)).toEqual([]);
    expect(briefEntries(digest(body, { status: 'failed' }), [asking], titleOf)).toEqual([]);
    expect(briefEntries(null, [asking], titleOf)).toEqual([]);
  });
});

describe('ticketEntries', () => {
  it('reads the key from the item id and leaves the title empty when unknown', () => {
    const entries = ticketEntries(
      digest({ items: [{ itemId: 'ticket:jira:API-81', text: 'Answer the agent.' }] }),
      () => null,
    );
    expect(entries).toEqual([
      {
        id: 'ticket:jira:API-81',
        key: 'API-81',
        title: '',
        text: 'Answer the agent.',
        verb: 'Open',
        target: { kind: 'ticket', itemId: 'ticket:jira:API-81' },
      },
    ]);
    expect(ticketKeyOf('ticket:linear')).toBeNull();
    expect(ticketKeyOf('chat:linear:WEB-1')).toBeNull();
  });
});

describe('writingMeta', () => {
  it('counts the flagged items it reads', () => {
    expect(writingMeta(0)).toBe('Reading your recent chats…');
    expect(writingMeta(1)).toBe('Reading 1 flagged item and your recent chats…');
    expect(writingMeta(7)).toBe('Reading 7 flagged items and your recent chats…');
  });
});
