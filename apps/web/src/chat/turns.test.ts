import { describe, expect, it } from 'vitest';
import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { buildTurns, latestReplyId } from './turns.ts';

const RUN = '00000000-0000-4000-8000-000000000001';
const ASKED = '00000000-0000-4000-8000-000000000010';

function message(id: string, role: Message['role'], content: string, runId: string | null) {
  return { id, role, content, runId, createdAt: `2026-10-10T10:00:0${id}.000Z` } as Message;
}

function detail(messages: Message[]): Pick<ConversationDetail, 'messages' | 'runs'> {
  const run = { id: RUN, userMessageId: ASKED, parentRunId: null } as Run;
  return { messages, runs: [run] };
}

describe('the turns of a chat', () => {
  it('keeps the work reply as the reply of a run that also stored a publish reply', () => {
    const work = message('1', 'assistant', 'Changed the parser. Tests pass.', RUN);
    const publish = message('2', 'assistant', 'Pushed and opened pull request #4.', RUN);
    const [turn] = buildTurns(detail([message(ASKED, 'user', 'Fix it', null), work, publish]));
    expect(turn!.assistantMessage).toBe(work);
    expect(turn!.laterMessages).toEqual([publish]);
  });

  it('has no later message for a run with one reply', () => {
    const work = message('1', 'assistant', 'Done.', RUN);
    const [turn] = buildTurns(detail([work]));
    expect(turn!.assistantMessage).toBe(work);
    expect(turn!.laterMessages).toEqual([]);
  });

  it('gives a run with no reply yet no messages', () => {
    const [turn] = buildTurns(detail([]));
    expect(turn!.assistantMessage).toBeNull();
    expect(turn!.laterMessages).toEqual([]);
  });

  it("names the latest turn's work reply as the latest reply, as the thread tags the turn", () => {
    const work = message('1', 'assistant', 'Changed the parser.', RUN);
    const publish = message('2', 'assistant', 'Pushed.', RUN);
    expect(latestReplyId(detail([work, publish]))).toBe('1');
    expect(latestReplyId(detail([]))).toBeNull();
  });
});
