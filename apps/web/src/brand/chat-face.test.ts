import { describe, expect, it } from 'vitest';
import { TEAMMATE_COLORS } from '@spark-outpost/contracts';
import { CHAT_FACE_SHAPES, CHAT_FACE_STATES, chatFace, chatFaceSeed, isLive } from './chat-face.ts';

const CHAT = '0c000000-0000-4000-8000-000000000001';

function chatId(number: number): string {
  return `0c000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

describe('chatFace', () => {
  it('keeps one colour and shape for a chat in every state', () => {
    const idle = chatFace(CHAT, 'idle');
    for (const state of CHAT_FACE_STATES) {
      expect(chatFace(CHAT, state)).toMatchObject({ color: idle.color, shape: idle.shape });
    }
    expect(chatFace(CHAT, 'idle')).toEqual(idle);
  });

  it('gives every state its own expression', () => {
    expect(CHAT_FACE_STATES.map((state) => [state, chatFace(CHAT, state).expression])).toEqual([
      ['idle', 'idle'],
      ['working', 'thinking'],
      ['needs_you', 'unsure'],
      ['done', 'happy'],
      ['failed', 'sad'],
      ['archived', 'sleepy'],
    ]);
  });

  it('draws only from the Spark face colours and the roomy shapes, and uses all of them', () => {
    const looks = Array.from({ length: 400 }, (_, index) => chatFace(chatId(index), 'idle'));
    expect(new Set(looks.map((look) => look.color))).toEqual(new Set(TEAMMATE_COLORS));
    expect(new Set(looks.map((look) => look.shape))).toEqual(new Set(CHAT_FACE_SHAPES));
  });

  it('tells most neighbouring chats apart by colour or shape', () => {
    const looks = Array.from({ length: 400 }, (_, index) => chatFace(chatId(index), 'idle'));
    const twins = looks.filter((look, index) => {
      const next = looks[index + 1];
      return next?.color === look.color && next.shape === look.shape;
    });
    expect(twins.length).toBeLessThan(20);
  });

  it('seeds the blob from the chat id', () => {
    expect(chatFaceSeed(CHAT)).toBe(`chat:${CHAT}`);
  });

  it('moves only while working or waiting for the user', () => {
    expect(CHAT_FACE_STATES.filter(isLive)).toEqual(['working', 'needs_you']);
  });
});
