import { describe, expect, it } from 'vitest';
import type { ChatAsk } from '@spark-outpost/contracts';
import { receivedLabel, steeredAsks, turnAskLines, turnStartAsk } from './ask-lines.ts';

const PARENT = '11111111-1111-4111-8111-111111111111';
const WEB = '22222222-2222-4222-8222-222222222222';
const API = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';
const OTHER_RUN = '55555555-5555-4555-8555-555555555555';

let next = 0;

function ask(overrides: Partial<ChatAsk>): ChatAsk {
  next += 1;
  return {
    id: `66666666-6666-4666-8666-${String(next).padStart(12, '0')}`,
    kind: 'message',
    from: { id: PARENT, title: 'Checkout rewrite' },
    fromRunId: RUN,
    to: { id: WEB, title: 'Web' },
    body: 'Which port does the API use?',
    replyTo: null,
    state: 'waiting',
    deliveredAs: null,
    runId: null,
    noReplyReason: null,
    report: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    settledAt: null,
    ...overrides,
  };
}

const texts = (asks: ChatAsk[], chat = PARENT, runs = [RUN]) =>
  turnAskLines(asks, chat, runs).flatMap((group) => group.lines.map((line) => line.text));

describe('lines for messages between chats', () => {
  it('words what the sender sees by the ask’s state', () => {
    expect(texts([ask({})])).toEqual(['Asked Web: Which port does the API use? · Waiting']);
    expect(texts([ask({ state: 'replied' })])).toEqual([
      'Asked Web: Which port does the API use? · Replied',
    ]);
    expect(texts([ask({ state: null, body: 'The API is on 4000.' })])).toEqual([
      'Sent to Web: The API is on 4000.',
    ]);
  });

  it('adds why there was no reply', () => {
    const [group] = turnAskLines(
      [ask({ state: 'no_reply', noReplyReason: 'Its turn was stopped.' })],
      PARENT,
      [RUN],
    );
    expect(group?.lines[0]).toMatchObject({
      side: 'sent',
      text: 'Asked Web: Which port does the API use? · No reply',
      note: 'Its turn was stopped.',
    });
  });

  it('shows a steered message in the receiver as not the user’s', () => {
    const steered = ask({ deliveredAs: 'steer', runId: OTHER_RUN });
    expect(texts([steered], WEB, [OTHER_RUN])).toEqual([
      'From Checkout rewrite: Which port does the API use? · not your message',
    ]);
    expect(texts([steered], WEB, [RUN])).toEqual([]);
  });

  it('leaves a steered message out of the end-of-turn lines when the turn places it', () => {
    const steered = ask({ deliveredAs: 'steer', runId: OTHER_RUN });
    const sent = ask({
      from: { id: WEB, title: 'Web' },
      fromRunId: OTHER_RUN,
      to: { id: API, title: 'API' },
    });
    expect(steeredAsks([steered, sent], WEB, [OTHER_RUN])).toEqual([steered]);
    const lines = turnAskLines([steered, sent], WEB, [OTHER_RUN], false);
    expect(lines.flatMap((group) => group.lines.map((line) => line.side))).toEqual(['sent']);
  });

  it('leaves the ask that started the turn to the turn’s own header', () => {
    const started = ask({ deliveredAs: 'turn', runId: OTHER_RUN });
    expect(texts([started], WEB, [OTHER_RUN])).toEqual([]);
    expect(turnStartAsk([started], WEB, started.id)).toBe(started);
    expect(turnStartAsk([started], PARENT, started.id)).toBeNull();
    expect(turnStartAsk([started], WEB, null)).toBeNull();
  });

  it('keeps tasks, reports and replies this chat sent out of its own lines', () => {
    const sent = (['task', 'report', 'reply', 'wrap_up'] as const).map((kind) => ask({ kind }));
    expect(texts(sent)).toEqual([]);
  });

  it('names a reply, a no-reply notice, a report and the wrap-up', () => {
    const original = ask({ state: 'no_reply' });
    const from = { id: WEB, title: 'Web' };
    const to = { id: PARENT, title: 'Checkout rewrite' };
    const reply = ask({ kind: 'reply', from, to, body: 'Port 4000.', replyTo: null });
    const notice = ask({
      kind: 'reply',
      from,
      to,
      body: 'No reply: Its turn was stopped.',
      replyTo: original.id,
    });
    const all = [original, reply, notice];
    expect(receivedLabel(reply, all)).toBe('Reply from Web: Port 4000. · not your message');
    expect(receivedLabel(notice, all)).toBe(
      'No reply from Web: Its turn was stopped. · not your message',
    );
    expect(receivedLabel(ask({ kind: 'report', from, to }), all)).toBe(
      'Report from Web · not your message',
    );
    expect(
      receivedLabel(ask({ kind: 'wrap_up', from: { id: null, title: 'Spark' }, to }), all),
    ).toBe('Wrap-up from Spark · not your message');
  });

  it('reads a reply that only starts with “No reply” as a reply when its ask was answered', () => {
    const original = ask({ state: 'replied' });
    const reply = ask({
      kind: 'reply',
      from: { id: WEB, title: 'Web' },
      to: { id: PARENT, title: 'Checkout rewrite' },
      body: 'No reply: is what the client prints.',
      replyTo: original.id,
    });
    expect(receivedLabel(reply, [original, reply])).toBe(
      'Reply from Web: No reply: is what the client prints. · not your message',
    );
  });

  it('collapses repeated rounds with one chat in a turn and leaves single ones flat', () => {
    const toApi = { id: API, title: 'API' };
    const groups = turnAskLines(
      [
        ask({ state: 'replied' }),
        ask({
          kind: 'reply',
          from: { id: WEB, title: 'Web' },
          to: { id: PARENT, title: 'Checkout rewrite' },
          body: 'Port 4000.',
          deliveredAs: 'steer',
          runId: RUN,
        }),
        ask({ body: 'And the staging port?' }),
        ask({ to: toApi, body: 'Keep the v1 routes.', state: null }),
        ask({ fromRunId: OTHER_RUN, body: 'A later turn.' }),
      ],
      PARENT,
      [RUN],
    );
    expect(groups.map((group) => [group.chat, group.summary, group.lines.length])).toEqual([
      ['Web', '2 exchanges with Web', 3],
      ['API', null, 1],
    ]);
  });

  it('still shows a line from a chat that was deleted', () => {
    const gone = ask({
      from: { id: null, title: 'Old spike' },
      to: { id: PARENT, title: 'Checkout rewrite' },
      body: 'No reply: That chat was deleted.',
      kind: 'reply',
      deliveredAs: 'steer',
      runId: RUN,
    });
    const [group] = turnAskLines([gone], PARENT, [RUN]);
    expect(group).toMatchObject({ chat: 'Old spike', summary: null });
    expect(group?.lines[0]?.text).toBe(
      'No reply from Old spike: That chat was deleted. · not your message',
    );
  });

  it('has nothing to show without asks', () => {
    expect(turnAskLines(undefined, PARENT, [RUN])).toEqual([]);
    expect(turnAskLines([], PARENT, [RUN])).toEqual([]);
  });
});
