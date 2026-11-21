// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { API_CHAT, chat } from '../test/chat-fixtures.ts';
import { momentLine, useMoments } from './use-island-moments.ts';

const RUN_ID = '0e000000-0000-4000-8000-000000000001';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function turn(status: 'running' | 'succeeded'): ConversationSummary {
  return chat(API_CHAT, {
    title: 'Orders endpoint',
    latestRun: {
      id: RUN_ID,
      status,
      error: null,
      step: null,
      provider: null,
      progress: null,
      needsYou: null,
    },
  });
}

function momentsOf(first: ConversationSummary[]) {
  return renderHook(({ chats }) => useMoments(chats, true), { initialProps: { chats: first } });
}

describe('useMoments', () => {
  it('says a chat is done when its turn finishes', () => {
    const hook = momentsOf([turn('running')]);
    expect(hook.result.current.moment).toBeNull();
    hook.rerender({ chats: [turn('succeeded')] });
    expect(hook.result.current.moment).toEqual({ kind: 'done', chatId: API_CHAT, runId: RUN_ID });
    expect(hook.result.current.text).toBe('Orders endpoint is done.');
  });
});

describe('momentLine', () => {
  it('says the chat is done or could not finish', () => {
    expect(momentLine('done', 'Orders endpoint')).toBe('Orders endpoint is done.');
    expect(momentLine('failed', 'Orders endpoint')).toBe('Orders endpoint couldn’t finish.');
  });
});
