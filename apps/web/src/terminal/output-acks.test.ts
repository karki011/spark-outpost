import { describe, expect, it, vi } from 'vitest';
import { createAckCounter } from './output-acks.ts';

describe('createAckCounter', () => {
  it('reports written bytes once enough have gathered, and starts over', () => {
    const send = vi.fn();
    const written = createAckCounter(send, 100);
    written(60);
    expect(send).not.toHaveBeenCalled();
    written(60);
    expect(send).toHaveBeenLastCalledWith(120);
    written(99);
    expect(send).toHaveBeenCalledTimes(1);
    written(1);
    expect(send).toHaveBeenLastCalledWith(100);
  });
});
