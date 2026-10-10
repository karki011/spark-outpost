import { describe, expect, it } from 'vitest';
import type { ChatDraft } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT, note, post } from '../../outposts/test-fixtures.ts';
import { draftLabel, draftsInTurn, firstLine, sentInTurn, type TurnWindow } from './chat-lines.ts';

const RUN_ID = '0e000000-0000-4000-8000-000000000001';
const OTHER_RUN = '0e000000-0000-4000-8000-000000000002';
const DRAFT_ID = '0f000000-0000-4000-8000-000000000001';

function turn(overrides: Partial<TurnWindow> = {}): TurnWindow {
  return { id: RUN_ID, parentRunId: null, ...overrides };
}

function fromFe(number: number, overrides: Parameters<typeof post>[1] = {}) {
  return post(number, {
    fromUser: false,
    fromConversationId: FE_CHAT,
    fromHandle: 'fe',
    fromRunId: RUN_ID,
    ...overrides,
  });
}

function draft(overrides: Partial<ChatDraft> = {}): ChatDraft {
  return {
    id: DRAFT_ID,
    runId: RUN_ID,
    chats: 3,
    stacked: 0,
    outpostId: null,
    startedAt: null,
    ...overrides,
  };
}

describe('sentInTurn', () => {
  it('keeps the requests this turn of the chat sent', () => {
    const posts = [fromFe(0), fromFe(1, { fromRunId: OTHER_RUN }), fromFe(5)];
    expect(sentInTurn(posts, FE_CHAT, turn()).map((sent) => sent.id)).toEqual(
      [posts[0], posts[2]].map((sent) => sent?.id),
    );
  });

  it('leaves out what the user typed, what another chat sent and notes', () => {
    const posts = [
      post(2),
      fromFe(3, { fromConversationId: API_CHAT, fromHandle: 'api' }),
      note(4, { fromUser: false, fromConversationId: FE_CHAT, fromRunId: RUN_ID }),
    ];
    expect(sentInTurn(posts, FE_CHAT, turn())).toEqual([]);
  });

  it('leaves out a story’s first messages, which the user started and no turn sent', () => {
    const started = fromFe(5, { fromRunId: null, userStarted: true });
    expect(sentInTurn([started], FE_CHAT, turn())).toEqual([]);
  });

  it('shows nothing under a run that is part of another turn', () => {
    expect(sentInTurn([fromFe(5)], FE_CHAT, turn({ parentRunId: OTHER_RUN }))).toEqual([]);
  });
});

describe('draftsInTurn', () => {
  it('keeps the drafts the turn proposed', () => {
    const drafts = [draft(), draft({ id: OTHER_RUN, runId: OTHER_RUN }), draft({ runId: null })];
    expect(draftsInTurn(drafts, RUN_ID)).toEqual([drafts[0]]);
  });
});

describe('labels', () => {
  it('counts the proposed chats and the stacked ones', () => {
    expect(draftLabel(draft())).toBe('Proposed 3 chats');
    expect(draftLabel(draft({ chats: 1 }))).toBe('Proposed 1 chat');
    expect(draftLabel(draft({ chats: 4, stacked: 2 }))).toBe('Proposed 4 chats · 2 stacked');
  });

  it('says Started once the user started the draft', () => {
    expect(draftLabel(draft({ startedAt: '2026-10-09T10:30:00.000Z' }))).toBe('Started 3 chats');
  });

  it('takes the first line that has text', () => {
    expect(firstLine('\n  \n  List the fields  \nand the types')).toBe('List the fields');
    expect(firstLine('')).toBe('');
  });
});
