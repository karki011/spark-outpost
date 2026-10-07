import { describe, expect, it } from 'vitest';
import type { Approval, ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { chatOutline, turnAnchor } from './outline-model.ts';

const NONE = { changedRunIds: new Set<string>(), prUrls: [] };
const PR = 'https://github.com/acme/app/pull/12';

function run(id: string, extra: Partial<Run> = {}): Run {
  return { id, parentRunId: null, userMessageId: `u-${id}`, status: 'succeeded', ...extra } as Run;
}

function ask(id: string, content: string): Message {
  return { id: `u-${id}`, role: 'user', content, runId: null } as Message;
}

function reply(id: string, content: string): Message {
  return { id: `a-${id}`, role: 'assistant', content, runId: id } as Message;
}

function chat(extra: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    runs: [run('one'), run('two'), run('two-child', { parentRunId: 'two' }), run('three')],
    messages: [
      ask('one', 'Fix the date divider\nand keep the label'),
      reply('one', 'Done.'),
      ask('two', `${'Refactor the whole calendar module so every component '.repeat(3)}agrees`),
      reply('two', 'Refactored.'),
      ask('three', ''),
    ],
    approvals: [],
    ...extra,
  } as unknown as ConversationDetail;
}

describe('chatOutline', () => {
  it('lists each prompt by its first line, clipped at a word near 60 characters', () => {
    const outline = chatOutline(chat(), NONE);
    expect(outline.map((entry) => entry.id)).toEqual(['one', 'two', 'three']);
    expect(outline[0]!.label).toBe('Fix the date divider');
    expect(outline[1]!.label.length).toBeLessThanOrEqual(60);
    expect(outline[1]!.label.endsWith('…')).toBe(true);
    expect(outline[2]!.label).toBe('Message without text');
  });

  it('stays empty for chats shorter than three turns', () => {
    const short = chat({ runs: [run('one'), run('two')] });
    expect(chatOutline(short, NONE)).toEqual([]);
  });

  it('marks plans, approvals that waited, changed files, pull requests and errors', () => {
    const approvals = [
      {
        runId: 'one',
        kind: 'other',
        status: 'allowed',
        decidedBy: 'user',
        payload: { plan: 'Do it' },
      },
      { runId: 'two-child', kind: 'execute', status: 'allowed', decidedBy: 'user', payload: {} },
      { runId: 'three', kind: 'edit', status: 'allowed', decidedBy: 'allowlist', payload: {} },
    ] as unknown as Approval[];
    const detail = chat({
      approvals,
      runs: [
        run('one'),
        run('two'),
        run('two-child', { parentRunId: 'two' }),
        run('three', { status: 'failed' }),
      ],
      messages: [...chat().messages, reply('two-child', `Opened ${PR} for review.`)],
    });
    const outline = chatOutline(detail, {
      changedRunIds: new Set(['two-child']),
      prUrls: [PR],
    });
    expect(outline.map((entry) => entry.marks)).toEqual([
      ['plan'],
      ['approval', 'files', 'pr'],
      ['error'],
    ]);
  });

  it('marks a turn whose reply was saved or offered as a plan', () => {
    const detail = chat({
      plans: {
        saved: [{ messageId: 'a-one', version: 1 }],
        offers: [{ runId: 'two', messageId: 'a-two' }],
        lines: [{ runId: 'three', version: 2, items: 4, unit: 'pieces' }],
      },
    });
    expect(chatOutline(detail, NONE).map((entry) => entry.marks)).toEqual([
      ['plan'],
      ['plan'],
      ['plan'],
    ]);
  });

  it('previews the start of each reply as plain text', () => {
    const long = `## Result\n\n**Done.** The \`divider\` now reads the locale.\n\`\`\`ts\nconst hidden = 1;\n\`\`\`\n${'More words follow here. '.repeat(20)}`;
    const detail = chat();
    const messages = detail.messages.map((message) =>
      message.id === 'a-one' ? { ...message, content: long } : message,
    );
    const outline = chatOutline({ ...detail, messages }, NONE);
    expect(outline[0]!.reply.startsWith('Result Done. The divider now reads the locale.')).toBe(
      true,
    );
    expect(outline[0]!.reply).not.toContain('hidden');
    expect(outline[0]!.reply.length).toBeLessThanOrEqual(220);
    expect(outline[1]!.reply).toBe('Refactored.');
    expect(outline[2]!.reply).toBe('');
  });

  it('adds a tick for each message sent to a running turn, after its turn', () => {
    const detail = chat({
      memberMessages: [
        {
          id: 'steer-1',
          runId: 'two-child',
          body: 'Also keep the week view\nas it is',
          urgency: 'now',
          status: 'delivered',
          messageId: null,
          createdAt: '2026-01-01T00:00:00Z',
          deliveredAt: null,
        },
        {
          id: 'became-a-message',
          runId: 'two',
          body: 'Sent as the next message',
          urgency: 'now',
          status: 'sent',
          messageId: null,
          createdAt: '2026-01-01T00:00:01Z',
          deliveredAt: null,
        },
      ],
      orchestrations: { two: { crew: [{ runId: 'two-child' }] } },
    } as unknown as Partial<ConversationDetail>);
    const outline = chatOutline(detail, NONE);
    expect(outline.map((entry) => entry.anchor)).toEqual([
      'turn-one',
      'turn-two',
      'steer-steer-1',
      'turn-three',
    ]);
    expect(outline[2]).toMatchObject({
      id: 'steer-1',
      label: 'Also keep the week view',
      marks: [],
    });
  });

  it('anchors a turn by its run', () => {
    expect(turnAnchor('abc')).toBe('turn-abc');
  });
});
