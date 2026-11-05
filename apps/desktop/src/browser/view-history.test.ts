import { describe, expect, it, vi } from 'vitest';
import { API_TOKEN_HEADER, type BrowserHistoryEvent } from '@spark-outpost/contracts';
import { historyPoster } from './history-client.ts';
import { viewHistory } from './view-history.ts';

function tab(chatId: string, url: string) {
  return { chatId, currentUrl: () => url };
}

describe('Browser view history', () => {
  it('records a Browser view visit and its later title, with secrets hidden', () => {
    const events: BrowserHistoryEvent[] = [];
    const history = viewHistory((event) => events.push(event));
    const personal = tab('personal', 'https://app.example.com/cb?code=abc');
    history.visited(personal, 'https://app.example.com/cb?code=abc', '');
    history.titled(personal, 'Signed in');
    expect(events).toEqual([
      {
        kind: 'visit',
        profile: 'personal',
        url: 'https://app.example.com/cb?code=[redacted]',
        title: '',
      },
      {
        kind: 'title',
        profile: 'personal',
        url: 'https://app.example.com/cb?code=[redacted]',
        title: 'Signed in',
      },
    ]);
  });

  it('records nothing from a chat tab, a local file or a blank page', () => {
    const sink = vi.fn();
    const history = viewHistory(sink);
    history.visited(tab('0b0e8f0e-5d6b-4d6f-9a8b-2f6f9d1c1a10', ''), 'https://example.com/', '');
    history.visited(tab('work', ''), 'file:///Users/me/a.html', '');
    history.titled(tab('work', 'about:blank'), 'New tab');
    expect(sink).not.toHaveBeenCalled();
  });

  it('posts an event to the API with the launch token and swallows failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const post = historyPoster('http://127.0.0.1:4318', 'token-1', fetchImpl);
    post({ kind: 'visit', profile: 'work', url: 'https://example.com/', title: '' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:4318/api/browser-history');
    expect(init.headers[API_TOKEN_HEADER]).toBe('token-1');
    expect(JSON.parse(init.body)).toMatchObject({ profile: 'work', url: 'https://example.com/' });
  });

  it('sends a title only after its visit has been answered', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const post = historyPoster('http://127.0.0.1:4318', 'token-1', fetchImpl);
    post({ kind: 'visit', profile: 'work', url: 'https://example.com/', title: '' });
    post({ kind: 'title', profile: 'work', url: 'https://example.com/', title: 'Example' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    answer(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toMatchObject({ kind: 'title' });
  });
});
