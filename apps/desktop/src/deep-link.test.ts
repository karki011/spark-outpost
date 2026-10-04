import { describe, expect, it } from 'vitest';
import { parseSparkChatLink, sparkChatLink } from '@spark-outpost/contracts';
import { linkIn } from './deep-link.ts';

const CHAT = '3f0c9a52-6f0e-4d53-9a35-0d1f5a4b7c11';

describe('Spark chat links', () => {
  it('finds the link among the launch arguments', () => {
    expect(
      linkIn(['/Applications/Spark', '--flag', `spark-outpost://chat/${CHAT}`], 'spark-outpost'),
    ).toBe(`spark-outpost://chat/${CHAT}`);
    expect(linkIn(['/Applications/Spark'], 'spark-outpost')).toBeNull();
    expect(linkIn([`spark-outpost-dev://chat/${CHAT}`], 'spark-outpost')).toBeNull();
  });

  it('round-trips a chat id for each channel scheme', () => {
    expect(parseSparkChatLink(sparkChatLink(CHAT))).toBe(CHAT);
    expect(parseSparkChatLink(sparkChatLink(CHAT, 'spark-outpost-dev'), 'spark-outpost-dev')).toBe(
      CHAT,
    );
  });

  it('refuses anything that is not exactly a chat link', () => {
    for (const link of [
      `spark-outpost://chat/${CHAT}/../settings`,
      `spark-outpost://chat/${CHAT}?run=rm`,
      `spark-outpost://chat/${CHAT}#x`,
      `spark-outpost://settings/${CHAT}`,
      `spark-outpost://user@chat/${CHAT}`,
      'spark-outpost://chat/not-an-id',
      `https://chat/${CHAT}`,
      `spark-outpost-dev://chat/${CHAT}`,
      'not a url',
    ]) {
      expect(parseSparkChatLink(link), link).toBeNull();
    }
  });
});
