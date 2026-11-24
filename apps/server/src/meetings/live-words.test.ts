import { describe, expect, it, vi } from 'vitest';
import type { MeetingLiveWords } from '@spark-outpost/contracts';
import { createLiveWords } from './live-words.ts';

const MEETING = 'meeting-1';
const others = (text: string, startMs = 0): MeetingLiveWords => ({
  speaker: 'others',
  text,
  startMs,
});

describe('live words', () => {
  it('sends words to everyone watching that meeting and nobody else', () => {
    const live = createLiveWords();
    const mine = vi.fn();
    const elsewhere = vi.fn();
    live.watch(MEETING, mine, () => undefined);
    live.watch('meeting-2', elsewhere, () => undefined);
    live.push(MEETING, others('we ship'));
    expect(mine).toHaveBeenCalledWith(others('we ship'));
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it('gives a late watcher the newest words of each speaker while they are fresh', () => {
    let now = 1_000;
    const live = createLiveWords(() => now);
    live.push(MEETING, others('we'));
    live.push(MEETING, others('we ship'));
    live.push(MEETING, { speaker: 'you', text: 'ok', startMs: 500 });
    now += 2_000;
    const late = vi.fn();
    live.watch(MEETING, late, () => undefined);
    expect(late.mock.calls.map(([words]) => words.text)).toEqual(['we ship', 'ok']);
    now += 2_000;
    const later = vi.fn();
    live.watch(MEETING, later, () => undefined);
    expect(later).not.toHaveBeenCalled();
  });

  it('stops sending after a watcher leaves', () => {
    const live = createLiveWords();
    const listener = vi.fn();
    const leave = live.watch(MEETING, listener, () => undefined);
    expect(live.watchers(MEETING)).toBe(1);
    leave();
    live.push(MEETING, others('we ship'));
    expect(listener).not.toHaveBeenCalled();
    expect(live.watchers(MEETING)).toBe(0);
  });

  it('tells watchers when the meeting ends and forgets its words', () => {
    const live = createLiveWords();
    const ended = vi.fn();
    live.push(MEETING, others('we ship'));
    live.watch(MEETING, () => undefined, ended);
    live.end(MEETING);
    expect(ended).toHaveBeenCalledOnce();
    const late = vi.fn();
    live.watch(MEETING, late, () => undefined);
    expect(late).not.toHaveBeenCalled();
  });

  it('drops words that do not fit the contract', () => {
    const live = createLiveWords();
    const listener = vi.fn();
    live.watch(MEETING, listener, () => undefined);
    live.push(MEETING, { speaker: 'others', text: 'x'.repeat(5_000), startMs: 0 });
    live.push(MEETING, { speaker: 'others', text: 'ok', startMs: -1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
