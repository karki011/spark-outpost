import { describe, expect, it } from 'vitest';
import { chatsReadByRun, mentionedChats, type ToolEventRow } from './assistant-links.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function call(runId: string, id: string, name: string, args: string): ToolEventRow[] {
  return [
    { run_id: runId, type: 'TOOL_CALL_START', payload: { toolCallId: id, toolCallName: name } },
    { run_id: runId, type: 'TOOL_CALL_ARGS', payload: { toolCallId: id, delta: args } },
  ];
}

describe('chatsReadByRun', () => {
  it('collects the chats each run read with spark_chat or spark_chat_history, by id', () => {
    const read = chatsReadByRun([
      ...call('r1', 'c1', 'mcp__spark__spark_chat', JSON.stringify({ chat: A })),
      ...call(
        'r1',
        'c2',
        'spark.spark_chat_history',
        JSON.stringify({ chat: `spark-outpost://chat/${B}` }),
      ),
      ...call('r1', 'c3', 'mcp__spark__spark_chat', JSON.stringify({ chat: A.toUpperCase() })),
      ...call('r2', 'c1', 'spark_chat', JSON.stringify({ chat: B })),
      ...call('r3', 'c1', 'Reading chat history', JSON.stringify({ chat: A })),
      ...call('r3', 'c2', 'Reading a chat', JSON.stringify({ chat: B })),
      ...call('r4', 'c1', 'Looking at chats', JSON.stringify({ chat: A })),
    ]);
    expect(read).toEqual(
      new Map([
        ['r1', [A, B]],
        ['r2', [B]],
        ['r3', [A, B]],
      ]),
    );
  });

  it('ignores other tools, missing chats, titles and arguments cut short', () => {
    const read = chatsReadByRun([
      ...call('r1', 'c1', 'mcp__spark__spark_chats', JSON.stringify({ query: A })),
      ...call('r1', 'c2', 'mcp__spark__spark_chat', JSON.stringify({ digest: true })),
      ...call('r1', 'c3', 'mcp__spark__spark_chat', JSON.stringify({ chat: 'pipeline-poc' })),
      ...call('r1', 'c4', 'mcp__spark__spark_chat', `{"chat":"${A}`),
      ...call('r1', 'c5', 'mcp__other__spark_chat_now', JSON.stringify({ chat: A })),
    ]);
    expect(read).toEqual(new Map());
  });
});

describe('mentionedChats', () => {
  const chats = [
    { conversationId: A, title: 'pipeline-poc' },
    { conversationId: B, title: 'pipeline-poc v2' },
    { conversationId: '33333333-3333-4333-8333-333333333333', title: 'Fix' },
    { conversationId: '44444444-4444-4444-8444-444444444444', title: 'New chat' },
  ];

  it('links each named chat once, in the order the answer names them, longest title first', () => {
    expect(
      mentionedChats('**pipeline-poc v2** waits; Pipeline-POC is done.', chats).map(
        (chat) => chat.conversationId,
      ),
    ).toEqual([B, A]);
  });

  it('skips short and untitled chats and partial words', () => {
    expect(mentionedChats('Fix the New chat in pipeline-pocket.', chats)).toEqual([]);
  });

  it('links no chat whose title another chat shares', () => {
    const twins = [
      { conversationId: A, title: 'Fix login' },
      { conversationId: B, title: 'fix login' },
      { conversationId: '33333333-3333-4333-8333-333333333333', title: 'login' },
    ];
    expect(mentionedChats('Fix login is waiting.', twins)).toEqual([]);
  });

  it('links at most three chats', () => {
    const many = ['alpha', 'bravo', 'charlie', 'delta'].map((title, index) => ({
      conversationId: `${index}`,
      title,
    }));
    expect(mentionedChats('alpha bravo charlie delta', many)).toHaveLength(3);
  });
});
