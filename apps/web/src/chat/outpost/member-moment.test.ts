import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT, OUTPOST_ID, chat } from '../../outposts/test-fixtures.ts';
import { memberNeedsYou } from './member-moment.ts';

const RUN_ID = '0e000000-0000-4000-8000-000000000001';
const OTHER_RUN = '0e000000-0000-4000-8000-000000000002';

function finished(needsYou: string | null, runId = RUN_ID): ConversationSummary['latestRun'] {
  return {
    id: runId,
    status: 'succeeded',
    error: null,
    step: null,
    provider: null,
    progress: null,
    needsYou,
  };
}

const membership = { id: OUTPOST_ID, name: 'Orders launch', handle: 'api' };
const done = { kind: 'done' as const, chatId: API_CHAT, runId: RUN_ID };

describe('memberNeedsYou', () => {
  it('names the member and the outpost when its turn ended needing the user', () => {
    const chats = [chat(API_CHAT, { outpost: membership, latestRun: finished('Which field?') })];
    expect(memberNeedsYou(done, chats)).toBe('@api needs you in Orders launch.');
  });

  it('says nothing for a turn that needs nothing, failed or belongs to no outpost', () => {
    const member = chat(API_CHAT, { outpost: membership, latestRun: finished(null) });
    expect(memberNeedsYou(done, [member])).toBeNull();
    expect(
      memberNeedsYou(done, [chat(API_CHAT, { latestRun: finished('Which field?') })]),
    ).toBeNull();
    const asking = chat(API_CHAT, { outpost: membership, latestRun: finished('Which field?') });
    expect(memberNeedsYou({ ...done, kind: 'failed' }, [asking])).toBeNull();
    expect(memberNeedsYou({ ...done, chatId: FE_CHAT }, [asking])).toBeNull();
  });

  it('says nothing once the chat has moved on to a later turn', () => {
    const chats = [
      chat(API_CHAT, { outpost: membership, latestRun: finished('Again?', OTHER_RUN) }),
    ];
    expect(memberNeedsYou(done, chats)).toBeNull();
  });
});
