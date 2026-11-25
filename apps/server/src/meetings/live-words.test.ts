import { describe, expect, it, vi } from 'vitest';
import type { MeetingLiveWords } from '@spark-outpost/contracts';
import { createLiveWords } from './live-words.ts';

const MEETING = 'meeting-1';
function recording() {
  const live = createLiveWords();
  live.begin(MEETING);
  live.begin('meeting-2');
  return live;
}

const others = (text: string, startMs = 0): MeetingLiveWords => ({
  speaker: 'others',
  text,
  startMs,
});

describe('live words', () => {
  it('sends words to everyone watching that meeting and nobody else', () => {
    const live = recording();
    const mine = vi.fn();
    const elsewhere = vi.fn();
    live.watch(MEETING, mine, () => undefined);
    live.watch('meeting-2', elsewhere, () => undefined);
    live.push(MEETING, others('we ship'));
    expect(mine).toHaveBeenCalledWith(others('we ship'));
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it('sends a late watcher only the words heard after it joined', () => {
    const live = recording();
    live.push(MEETING, others('we'));
    const late = vi.fn();
    live.watch(MEETING, late, () => undefined);
    expect(late).not.toHaveBeenCalled();
    live.push(MEETING, others('we ship'));
    expect(late.mock.calls).toEqual([[others('we ship')]]);
  });

  it('stops sending after a watcher leaves', () => {
    const live = recording();
    const listener = vi.fn();
    const leave = live.watch(MEETING, listener, () => undefined);
    expect(live.watchers(MEETING)).toBe(1);
    leave();
    live.push(MEETING, others('we ship'));
    expect(listener).not.toHaveBeenCalled();
    expect(live.watchers(MEETING)).toBe(0);
  });

  it('tells watchers when the meeting ends', () => {
    const live = recording();
    const ended = vi.fn();
    live.watch(MEETING, () => undefined, ended);
    live.end(MEETING);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('keeps nothing for a meeting that has ended or never began', () => {
    const live = recording();
    live.end(MEETING);
    live.push(MEETING, others('late words'));
    live.push('never-began', others('stray'));
    for (const meetingId of [MEETING, 'never-began']) {
      const listener = vi.fn();
      const ended = vi.fn();
      live.watch(meetingId, listener, ended);
      expect(listener).not.toHaveBeenCalled();
      expect(ended).toHaveBeenCalledOnce();
      expect(live.watchers(meetingId)).toBe(0);
    }
  });

  it('drops words that do not fit the contract', () => {
    const live = recording();
    const listener = vi.fn();
    live.watch(MEETING, listener, () => undefined);
    live.push(MEETING, { speaker: 'others', text: 'x'.repeat(5_000), startMs: 0 });
    live.push(MEETING, { speaker: 'others', text: 'ok', startMs: -1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
