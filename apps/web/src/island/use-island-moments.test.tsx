// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { API_CHAT, OUTPOST_ID, chat } from '../outposts/test-fixtures.ts';
import { useMoments } from './use-island-moments.ts';

const RUN_ID = '0e000000-0000-4000-8000-000000000001';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function member(status: 'running' | 'succeeded', needsYou: string | null): ConversationSummary {
  return chat(API_CHAT, {
    outpost: { id: OUTPOST_ID, name: 'Orders launch', handle: 'api' },
    latestRun: {
      id: RUN_ID,
      status,
      error: null,
      step: null,
      provider: null,
      progress: null,
      needsYou,
    },
  });
}

function momentsOf(first: ConversationSummary[]) {
  return renderHook(({ chats }) => useMoments(chats, true), { initialProps: { chats: first } });
}

describe('useMoments', () => {
  it('names the member chat that finished needing the user', () => {
    const hook = momentsOf([member('running', null)]);
    expect(hook.result.current.memberLine).toBeNull();
    hook.rerender({ chats: [member('succeeded', 'Which field is the key?')] });
    expect(hook.result.current.moment).toEqual({ kind: 'done', chatId: API_CHAT, runId: RUN_ID });
    expect(hook.result.current.memberLine).toBe('@api needs you in Orders launch.');
  });

  it('has no member line for a turn that finished with nothing to ask', () => {
    const hook = momentsOf([member('running', null)]);
    hook.rerender({ chats: [member('succeeded', null)] });
    expect(hook.result.current.moment?.kind).toBe('done');
    expect(hook.result.current.memberLine).toBeNull();
  });
});
