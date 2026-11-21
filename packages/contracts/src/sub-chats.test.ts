import { describe, expect, it } from 'vitest';
import { conversationDetailSchema, conversationSummarySchema } from './conversations.ts';
import {
  chatAskSchema,
  exchangesLine,
  fromChatLine,
  sentToChatLine,
  startedSubChatsLine,
  startSubChatsActionSchema,
  SUB_CHAT_TASK_MAX,
  SUB_CHAT_TITLE_MAX,
  subChatPieceSchema,
  subChatReportSchema,
  subChatsResponseSchema,
  type ChatAsk,
  type SubChatReport,
  type SubChatRow,
} from './sub-chats.ts';

const PARENT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const ASK = '33333333-3333-4333-8333-333333333333';

const REPORT: SubChatReport = {
  status: 'ready_for_review',
  reason: null,
  changed: 'Added the orders endpoint.',
  risks: 'None stated',
  blockers: 'None stated',
  branch: 'spark/orders-api-1a2b',
  committed: true,
  pushed: true,
  pullRequest: {
    number: 12,
    url: 'https://github.com/acme/shop/pull/12',
    state: 'open',
    checks: 'passing',
  },
};

const ROW: SubChatRow = {
  id: CHILD,
  title: 'Orders API',
  position: 0,
  status: 'ready_for_review',
  why: null,
  task: 'Build the orders endpoint.',
  branch: 'spark/orders-api-1a2b',
  pullRequest: REPORT.pullRequest,
  startedWith: {
    provider: 'claude',
    model: 'sonnet',
    effort: 'medium',
    agentMode: 'auto',
    level: 'full-auto',
  },
  stackedOn: null,
  startsAfter: [{ id: PARENT, title: 'Schema' }],
  startedAt: '2026-11-20T10:00:00.000Z',
  report: REPORT,
  reportedAt: '2026-11-20T10:30:00.000Z',
};

const TASK_ASK: ChatAsk = {
  id: ASK,
  kind: 'task',
  from: { id: PARENT, title: 'Checkout rewrite' },
  fromRunId: null,
  to: { id: CHILD, title: 'Orders API' },
  body: 'Build the orders endpoint.',
  replyTo: null,
  state: 'waiting',
  deliveredAs: null,
  runId: null,
  noReplyReason: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  settledAt: null,
};

const SUMMARY = {
  id: CHILD,
  title: 'Orders API',
  updatedAt: '2026-11-20T10:00:00.000Z',
  projectIds: [],
  latestRun: null,
  archivedAt: null,
  pinnedAt: null,
  unread: false,
  needsInput: false,
};

describe('a plan piece', () => {
  it('needs only a title and a task, and waits on nothing by default', () => {
    expect(subChatPieceSchema.parse({ title: ' Orders API ', task: 'Build it.' })).toEqual({
      title: 'Orders API',
      task: 'Build it.',
      startsAfter: [],
    });
  });

  it('carries the choices the agent may make per piece', () => {
    const piece = {
      title: 'Web',
      task: 'Build the page.',
      project: 'shop-web',
      agent: 'codex',
      model: 'gpt-5',
      effort: 'high',
      mode: 'auto',
      autonomy: 'hands-off',
      stackedOn: 'Orders API',
      startsAfter: ['Orders API', 'Schema'],
    };
    expect(subChatPieceSchema.parse(piece)).toEqual(piece);
  });

  it('refuses an empty title or task, and ones past their limits', () => {
    const tooLong = { title: 'x'.repeat(SUB_CHAT_TITLE_MAX + 1), task: 'Build it.' };
    expect(subChatPieceSchema.safeParse({ title: ' ', task: 'Build it.' }).success).toBe(false);
    expect(subChatPieceSchema.safeParse({ title: 'Web', task: '' }).success).toBe(false);
    expect(subChatPieceSchema.safeParse(tooLong).success).toBe(false);
    expect(
      subChatPieceSchema.safeParse({ title: 'Web', task: 'x'.repeat(SUB_CHAT_TASK_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe('the start_sub_chats action', () => {
  it('needs at least one piece and has no upper limit', () => {
    const pieces = Array.from({ length: 40 }, (_, index) => ({
      title: `Piece ${index}`,
      task: 'Do it.',
    }));
    expect(startSubChatsActionSchema.safeParse({ action: 'start_sub_chats', pieces }).success).toBe(
      true,
    );
    expect(
      startSubChatsActionSchema.safeParse({ action: 'start_sub_chats', pieces: [] }).success,
    ).toBe(false);
  });
});

describe('rows, reports and asks', () => {
  it('accepts a sub-chat row with its report', () => {
    expect(subChatsResponseSchema.parse({ subChats: [ROW] })).toEqual({ subChats: [ROW] });
  });

  it('refuses a report with a status outside the five words', () => {
    expect(subChatReportSchema.safeParse({ ...REPORT, status: 'idle' }).success).toBe(false);
  });

  it('accepts a wrap-up Spark wrote, which has no sending chat', () => {
    const wrapUp = {
      ...TASK_ASK,
      kind: 'wrap_up',
      from: { id: null, title: 'Spark' },
      state: null,
    };
    expect(chatAskSchema.parse(wrapUp)).toEqual(wrapUp);
  });
});

describe('chat summaries and details', () => {
  it('carry the parent and the status of a sub-chat', () => {
    const summary = conversationSummarySchema.parse({
      ...SUMMARY,
      parent: { id: PARENT, title: 'Checkout rewrite' },
      subChat: { position: 2, status: 'held' },
    });
    expect(summary.parent).toEqual({ id: PARENT, title: 'Checkout rewrite' });
    expect(summary.subChat).toEqual({ position: 2, status: 'held' });
  });

  it('carry the former parent by title once the parent is deleted', () => {
    const summary = conversationSummarySchema.parse({
      ...SUMMARY,
      formerParent: { title: 'Checkout rewrite' },
      subChat: { position: 0, status: 'done' },
    });
    expect(summary.parent).toBeUndefined();
    expect(summary.formerParent).toEqual({ title: 'Checkout rewrite' });
  });

  it('carry a count on a parent and the asks on a detail', () => {
    expect(conversationSummarySchema.parse({ ...SUMMARY, subChatCount: 3 }).subChatCount).toBe(3);
    expect(conversationDetailSchema.shape.asks.parse([TASK_ASK])).toEqual([TASK_ASK]);
  });
});

describe('line texts', () => {
  it('names the sub-chats a turn started, singular and plural', () => {
    expect(startedSubChatsLine(['Orders API'])).toBe('Started 1 sub-chat: Orders API');
    expect(startedSubChatsLine(['Orders API', 'Web', 'Docs'])).toBe(
      'Started 3 sub-chats: Orders API, Web, Docs',
    );
  });

  it('shows the first line of a message with its ask state', () => {
    const body = 'What does the endpoint return?\n\nI need the shape.';
    expect(sentToChatLine('Orders API', body, 'waiting')).toBe(
      'Asked Orders API: What does the endpoint return? · Waiting',
    );
    expect(sentToChatLine('Orders API', body, 'replied')).toBe(
      'Asked Orders API: What does the endpoint return? · Replied',
    );
    expect(sentToChatLine('Orders API', body, 'no_reply')).toBe(
      'Asked Orders API: What does the endpoint return? · No reply',
    );
  });

  it('says Sent when no reply was asked for', () => {
    expect(sentToChatLine('Web', 'The schema changed.', null)).toBe(
      'Sent to Web: The schema changed.',
    );
  });

  it('shows the first line of a received message', () => {
    expect(fromChatLine('Checkout rewrite', '  Use the v2 schema.\nDetails follow.')).toBe(
      'From Checkout rewrite: Use the v2 schema.',
    );
  });

  it('clips a long first line', () => {
    const line = fromChatLine('Web', 'word '.repeat(80));
    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThan(140);
  });

  it('counts exchanges, singular and plural', () => {
    expect(exchangesLine(1, 'Web')).toBe('1 exchange with Web');
    expect(exchangesLine(3, 'Web')).toBe('3 exchanges with Web');
  });
});
