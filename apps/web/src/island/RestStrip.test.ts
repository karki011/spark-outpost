import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@spark-outpost/contracts';
import type { Card } from './island-model.ts';
import { hasHoverLine, type StripData } from './RestStrip.tsx';

const quiet: StripData = { meeting: null, top: null };
const request = { ...quiet, top: { kind: 'approval' } as Card };
const meeting = { ...quiet, meeting: { key: 'm' } as CalendarEvent };

describe('when hovering resting Scout shows one line', () => {
  it('shows the top request even while a calendar line hangs from Scout', () => {
    expect(hasHoverLine(request, true)).toBe(true);
    expect(hasHoverLine(request, false)).toBe(true);
  });

  it('leaves a meeting to the calendar line, and has no line with nothing waiting', () => {
    expect(hasHoverLine(meeting, true)).toBe(false);
    expect(hasHoverLine(meeting, false)).toBe(true);
    expect(hasHoverLine(quiet, false)).toBe(false);
  });
});
