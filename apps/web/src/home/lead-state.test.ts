import { describe, expect, it } from 'vitest';
import { isEvening, pickLead, type LeadInput } from './lead-state.ts';

const at = (hour: number, minute = 0) => new Date(2026, 10, 10, hour, minute).getTime();
const base: LeadInput = {
  loading: false,
  now: at(11),
  meetingActive: false,
  awayUpdates: 0,
  busy: 0,
};

describe('pickLead', () => {
  it('shows the board when nothing asks for a lead', () => {
    expect(pickLead(base)).toBe('board');
    expect(pickLead({ ...base, busy: 3 })).toBe('board');
  });

  it('picks each lead from its own input', () => {
    expect(pickLead({ ...base, meetingActive: true })).toBe('meeting');
    expect(pickLead({ ...base, awayUpdates: 2 })).toBe('since-you-left');
    expect(pickLead({ ...base, now: at(18), busy: 1 })).toBe('before-you-go');
  });

  it('prefers meeting, then since you left, then before you go', () => {
    const all = { ...base, now: at(18), meetingActive: true, awayUpdates: 1, busy: 2 };
    expect(pickLead(all)).toBe('meeting');
    expect(pickLead({ ...all, meetingActive: false })).toBe('since-you-left');
    expect(pickLead({ ...all, meetingActive: false, awayUpdates: 0 })).toBe('before-you-go');
  });

  it('reserves the lead while data loads, whatever else is known', () => {
    expect(pickLead({ ...base, loading: true, meetingActive: true, awayUpdates: 4 })).toBe(
      'loading',
    );
  });

  it('starts the evening at 17:00 and ends it at 04:00', () => {
    const busy = { ...base, busy: 1 };
    expect(pickLead({ ...busy, now: at(16, 59) })).toBe('board');
    expect(pickLead({ ...busy, now: at(17, 0) })).toBe('before-you-go');
    expect(pickLead({ ...busy, now: at(23, 59) })).toBe('before-you-go');
    expect(pickLead({ ...busy, now: at(0, 0) })).toBe('before-you-go');
    expect(pickLead({ ...busy, now: at(3, 59) })).toBe('before-you-go');
    expect(pickLead({ ...busy, now: at(4, 0) })).toBe('board');
    expect(isEvening(at(12))).toBe(false);
  });

  it('needs something running or waiting for the evening lead', () => {
    expect(pickLead({ ...base, now: at(20), busy: 0 })).toBe('board');
  });

  it('never picks the meeting lead without a meeting, as with no calendar or on a paired device', () => {
    expect(pickLead({ ...base, meetingActive: false, awayUpdates: 0 })).toBe('board');
  });
});
