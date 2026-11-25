import { describe, expect, it } from 'vitest';
import type { ConversationDetail, Message, Run } from '@spark-outpost/contracts';
import { activeRun, activeRuns, buildTurns, latestReplyId } from './turns.ts';

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

describe('the chat\u2019s own active turn', () => {
  const run = (id: string, status: Run['status'], prFollowUp = false) =>
    ({ id, status, parentRunId: null, prFollowUp }) as Run;
  const chat = (runs: Run[]) => ({ messages: [], runs }) as unknown as ConversationDetail;

  it('is free while only a follow-up round runs', () => {
    const only = chat([run('a', 'succeeded'), run('round', 'running', true)]);
    expect(activeRun(only)).toBeNull();
    expect(activeRuns(only)).toEqual([]);
  });

  it('is the user\u2019s turn when one runs beside a round', () => {
    const both = chat([run('round', 'running', true), run('mine', 'running')]);
    expect(activeRun(both)?.id).toBe('mine');
    expect(activeRuns(both).map((entry) => entry.id)).toEqual(['mine']);
  });
});
