// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingLiveWords } from '@spark-outpost/contracts';
import { TranscriptPane } from './TranscriptPane.tsx';
import { MEETING_ID, lines, meeting, mockFetch, newClient } from './meetings-test-support.tsx';
import { useMeetingLive } from './use-meeting-live.ts';

class FakeEventSource {
  static opened: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }

  close() {
    this.closed = true;
  }
}

function hear(words: MeetingLiveWords | string) {
  const data = typeof words === 'string' ? words : JSON.stringify(words);
  act(() => FakeEventSource.opened.at(-1)?.onmessage?.(new MessageEvent('message', { data })));
}

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function recording(lineCount: number) {
  return meeting({ state: 'recording', endedAt: null, lineCount, notesState: 'none' });
}

function show(lineCount: number, stored = lineCount) {
  mockFetch(({ path }) => {
    if (path.includes('tail=1')) return { lines: lines(1, stored), more: false };
    if (path.includes('/lines')) return { lines: lines(stored + 1, lineCount), more: false };
  });
  const client = newClient();
  const view = render(
    <QueryClientProvider client={client}>
      <TranscriptPane meeting={recording(stored)} />
    </QueryClientProvider>,
  );
  const grow = (count: number) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <TranscriptPane meeting={recording(count)} />
      </QueryClientProvider>,
    );
  return { grow };
}

describe('Transcript live words', () => {
  it('shows the words so far as one muted line after the stored lines', async () => {
    show(2);
    const list = await screen.findByRole('list', { name: 'Transcript' });
    expect(FakeEventSource.opened.at(-1)?.url).toBe(`/api/meetings/${MEETING_ID}/live`);
    hear({ speaker: 'you', text: 'we should', startMs: 3_000 });
    hear({ speaker: 'you', text: 'we should ship', startMs: 3_000 });
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[2]?.className).toContain('mt-line-live');
    expect(items[2]?.textContent).toContain('You');
    expect(items[2]?.textContent).toContain('we should ship');
  });

  it('shows words before the first line is stored', async () => {
    show(0);
    expect(await screen.findByText(/Listening/)).toBeTruthy();
    hear({ speaker: 'others', text: 'thanks for joining', startMs: 0 });
    expect(screen.getByRole('list', { name: 'Transcript' }).textContent).toContain(
      'thanks for joining',
    );
  });

  it('replaces the words with the stored line of that sentence', async () => {
    const { grow } = show(3, 2);
    const list = await screen.findByRole('list', { name: 'Transcript' });
    hear({ speaker: 'you', text: 'line thr', startMs: 3_000 });
    hear({ speaker: 'others', text: 'and then', startMs: 4_000 });
    expect(list.querySelectorAll('.mt-line-live')).toHaveLength(2);
    grow(3);
    expect(await screen.findByText('line 3')).toBeTruthy();
    const live = list.querySelectorAll('.mt-line-live');
    expect(live).toHaveLength(1);
    expect(live[0]?.textContent).toContain('and then');
  });

  it('ignores a message that is not live words', async () => {
    show(1);
    const list = await screen.findByRole('list', { name: 'Transcript' });
    hear('not json');
    hear(JSON.stringify({ speaker: 'someone', text: 'x', startMs: 0 }));
    expect(list.querySelectorAll('.mt-line-live')).toHaveLength(0);
  });

  it('follows nothing once the meeting has ended', async () => {
    mockFetch(({ path }) =>
      path.includes('/lines') ? { lines: lines(1, 1), more: false } : undefined,
    );
    render(
      <QueryClientProvider client={newClient()}>
        <TranscriptPane meeting={meeting({ lineCount: 1 })} />
      </QueryClientProvider>,
    );
    await screen.findByRole('list', { name: 'Transcript' });
    expect(FakeEventSource.opened).toHaveLength(0);
  });
});

describe('useMeetingLive', () => {
  it('drops words that stopped changing and closes the stream when recording ends', () => {
    vi.useFakeTimers();
    const view = renderHook(({ on }) => useMeetingLive(MEETING_ID, on), {
      initialProps: { on: true },
    });
    hear({ speaker: 'others', text: 'hello', startMs: 0 });
    expect(view.result.current).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(2_900));
    hear({ speaker: 'others', text: 'hello there', startMs: 0 });
    act(() => void vi.advanceTimersByTime(2_900));
    expect(view.result.current[0]?.text).toBe('hello there');
    act(() => void vi.advanceTimersByTime(200));
    expect(view.result.current).toHaveLength(0);
    const source = FakeEventSource.opened.at(-1);
    view.rerender({ on: false });
    expect(source?.closed).toBe(true);
  });

  it('lists the speakers in the order their sentences began', () => {
    const view = renderHook(() => useMeetingLive(MEETING_ID, true));
    hear({ speaker: 'you', text: 'second', startMs: 2_000 });
    hear({ speaker: 'others', text: 'first', startMs: 1_000 });
    expect(view.result.current.map((words) => words.text)).toEqual(['first', 'second']);
  });
});
