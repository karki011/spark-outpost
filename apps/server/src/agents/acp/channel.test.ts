import { describe, expect, it } from 'vitest';
import { Channel } from './channel.ts';

describe('channel', () => {
  it('delivers items pushed before and after the reader starts, then ends on close', async () => {
    const channel = new Channel<number>();
    channel.push(1);
    const read = (async () => {
      const seen: number[] = [];
      for await (const item of channel) seen.push(item);
      return seen;
    })();
    channel.push(2);
    setTimeout(() => {
      channel.push(3);
      channel.close();
      channel.push(4);
    }, 5);
    expect(await read).toEqual([1, 2, 3]);
  });

  it('throws the close error after draining queued items', async () => {
    const channel = new Channel<string>();
    channel.push('a');
    channel.close(new Error('boom'));
    const seen: string[] = [];
    await expect(async () => {
      for await (const item of channel) seen.push(item);
    }).rejects.toThrow('boom');
    expect(seen).toEqual(['a']);
  });
});
