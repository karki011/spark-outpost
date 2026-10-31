import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTerminalLive, sessionOf, usageOf } from './terminal-live.ts';

const A = '0198c0de-0000-7000-8000-00000000000a';
const B = '0198c0de-0000-7000-8000-00000000000b';

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ [A]: { session: null } })));

beforeEach(() => {
  fetchMock.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadTerminalLive', () => {
  it('merges polls that fire together into one request, one entry per chat', async () => {
    const answers = Promise.all([loadTerminalLive(A), loadTerminalLive(A), loadTerminalLive(B)]);
    await vi.advanceTimersByTimeAsync(40);
    const [first, second, third] = await answers;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      `/api/terminal-live?chats=${A},${B}`,
    );
    expect(sessionOf(first)).toBeNull();
    expect(second).toEqual(first);
    expect(() => sessionOf(third)).toThrow();
    expect(() => usageOf(third)).toThrow();
  });

  it('fails every poll in the merged request together', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    const answer = loadTerminalLive(A);
    const failed = expect(answer).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(40);
    await failed;
  });
});
