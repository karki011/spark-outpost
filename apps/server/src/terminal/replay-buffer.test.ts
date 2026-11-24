import { describe, expect, it } from 'vitest';
import { createReplayBuffer } from './replay-buffer.ts';

function naive(limit: number) {
  let replay = '';
  return {
    push: (data: string) => {
      replay = (replay + data).slice(-limit);
    },
    text: () => replay,
  };
}

describe('createReplayBuffer', () => {
  it('is empty before any output', () => {
    expect(createReplayBuffer(10).text()).toBe('');
  });

  it('keeps everything under the limit', () => {
    const buffer = createReplayBuffer(10);
    buffer.push('abc');
    buffer.push('def');
    expect(buffer.text()).toBe('abcdef');
  });

  it('keeps only the tail of one chunk longer than the limit', () => {
    const buffer = createReplayBuffer(4);
    buffer.push('abcdefgh');
    expect(buffer.text()).toBe('efgh');
  });

  it('matches the tail of the whole stream for mixed chunk sizes', () => {
    const buffer = createReplayBuffer(37);
    const expected = naive(37);
    for (let index = 0; index < 5000; index++) {
      const chunk = String(index).repeat((index * 7) % 11);
      buffer.push(chunk);
      expected.push(chunk);
      if (index % 613 === 0) expect(buffer.text()).toBe(expected.text());
    }
    expect(buffer.text()).toBe(expected.text());
  });

  it('keeps taking output after it was read', () => {
    const buffer = createReplayBuffer(5);
    buffer.push('abcdefg');
    expect(buffer.text()).toBe('cdefg');
    buffer.push('hi');
    expect(buffer.text()).toBe('efghi');
  });
});
