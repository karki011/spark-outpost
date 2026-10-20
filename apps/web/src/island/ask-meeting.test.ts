import { describe, expect, it } from 'vitest';
import { at, event } from '../calendar/test-fixtures.ts';
import { meetingAnswer, NEXT_MEETING_QUESTION } from './ask-meeting.ts';

describe('meetingAnswer', () => {
  const now = at(9, 50);
  const meetings = [event('Standup', at(9, 30), at(10)), event('Design review', at(10, 2), at(11))];

  it('answers the next meeting that has not started, from the island calendar', () => {
    expect(meetingAnswer(NEXT_MEETING_QUESTION, meetings, now)).toBe(
      'Your next meeting is “Design review” in 12 min.',
    );
    expect(meetingAnswer('when is my upcoming call', [], now)).toBe('No meetings coming up.');
  });

  it('leaves other questions and an off calendar to the model', () => {
    expect(meetingAnswer('What did the meeting decide?', meetings, now)).toBeNull();
    expect(meetingAnswer(NEXT_MEETING_QUESTION, null, now)).toBeNull();
  });

  it('leaves a request to act on a meeting to the model', () => {
    expect(meetingAnswer('Snooze my next meeting', meetings, now)).toBeNull();
    expect(meetingAnswer('join my next call', meetings, now)).toBeNull();
    expect(meetingAnswer('Dismiss the upcoming meeting', meetings, now)).toBeNull();
  });
});
