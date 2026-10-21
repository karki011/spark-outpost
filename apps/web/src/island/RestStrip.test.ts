import { describe, expect, it } from 'vitest';
import type { CalendarEvent, ConversationSummary } from '@spark-outpost/contracts';
import { stripShows, type StripData } from './RestStrip.tsx';

const quiet: StripData = { count: 0, meeting: null, working: [], top: null };
const working = { ...quiet, working: [{ id: 'a' } as ConversationSummary] };
const meeting = { ...quiet, meeting: { key: 'm' } as CalendarEvent };

describe('when the resting strip shows', () => {
  it('shows working chats and requests even while a calendar line hangs from Scout', () => {
    expect(stripShows(working, true)).toBe(true);
    expect(stripShows({ ...quiet, count: 1 }, true)).toBe(true);
  });

  it('leaves a meeting alone to the calendar line, and shows nothing when nothing is on', () => {
    expect(stripShows(meeting, true)).toBe(false);
    expect(stripShows(meeting, false)).toBe(true);
    expect(stripShows(quiet, false)).toBe(false);
  });
});
