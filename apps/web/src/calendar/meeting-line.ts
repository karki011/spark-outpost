import { CALENDAR_SERVICE_NAMES, type CalendarEvent } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { clock, minutesUntil, span } from './calendar-format.ts';

export interface MeetingParts {
  lead: string;
  title: string;
  sub: string;
}

export interface MeetingLineInput {
  title: string;
  startsAt: string;
  event: CalendarEvent | null;
  count: number;
  chat: { title: string; reason: 'running' | 'needs_you' } | null;
  waiting: number;
  at: number;
}

function leadOf(input: MeetingLineInput): string {
  const minutes = minutesUntil(Date.parse(input.startsAt), input.at);
  const noun = input.count > 1 ? 'Meetings' : 'Meeting';
  return minutes === 0 ? `${noun} now` : `${noun} in ${minutes} min`;
}

function whenOf(input: MeetingLineInput): string {
  const start = Date.parse(input.startsAt);
  return input.event ? span(start, Date.parse(input.event.end)) : clock(start);
}

function detailOf(input: MeetingLineInput): string | null {
  if (input.chat) {
    const state = input.chat.reason === 'running' ? 'is still running' : 'needs you';
    return `${input.chat.title} ${state}`;
  }
  if (input.waiting > 0) return `${countLabel(input.waiting, 'chat needs', 'chats need')} you`;
  if (input.count > 1) return 'Choose one';
  const service = input.event?.link?.service;
  return service ? CALENDAR_SERVICE_NAMES[service] : null;
}

export function meetingParts(input: MeetingLineInput): MeetingParts {
  const more = input.count > 1 ? ` + ${input.count - 1} more` : '';
  const detail = detailOf(input);
  return {
    lead: leadOf(input),
    title: `${input.title}${more}`,
    sub: detail ? `${whenOf(input)} · ${detail}` : whenOf(input),
  };
}
