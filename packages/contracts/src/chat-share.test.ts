import { describe, expect, it } from 'vitest';
import { chatIdFromLink, chatShareState, parseChatReference } from './chat-share.ts';
import { sparkChatLink } from './slack.ts';

const CHAT = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';

const summary = (status: string | null, needsInput = false) => ({
  needsInput,
  attention: null,
  latestRun: status
    ? {
        id: CHAT,
        status: status as 'running',
        error: null,
        step: null,
        provider: null,
        progress: null,
      }
    : null,
});

describe('chat references', () => {
  it('reads a chat id from a bare id and from the link of either channel', () => {
    expect(parseChatReference(CHAT)).toBe(CHAT);
    expect(parseChatReference(`  ${CHAT.toUpperCase()} `)).toBe(CHAT);
    expect(parseChatReference(sparkChatLink(CHAT))).toBe(CHAT);
    expect(parseChatReference(sparkChatLink(CHAT, 'spark-outpost-dev'))).toBe(CHAT);
  });

  it('refuses other text, other schemes and links with more after the id', () => {
    for (const raw of [
      '',
      'chat',
      `https://chat/${CHAT}`,
      `other://chat/${CHAT}`,
      `spark-outpost://chat/${CHAT}/messages`,
      `spark-outpost://run/${CHAT}`,
      `see spark-outpost://chat/${CHAT}`,
    ]) {
      expect(parseChatReference(raw), raw).toBeNull();
    }
  });

  it('treats only a link, never a bare id, as a pasted chat link', () => {
    expect(chatIdFromLink(sparkChatLink(CHAT))).toBe(CHAT);
    expect(chatIdFromLink(CHAT)).toBeNull();
  });
});

describe('chatShareState', () => {
  it('names the state another chat is in', () => {
    expect(chatShareState(summary(null))).toBe('idle');
    expect(chatShareState(summary('running'))).toBe('working');
    expect(chatShareState(summary('awaiting_approval'))).toBe('working');
    expect(chatShareState(summary('running', true))).toBe('needs_you');
    expect(chatShareState(summary('failed'))).toBe('failed');
    expect(chatShareState(summary('succeeded'))).toBe('done');
  });
});
