import type { HelperEvent, HelperEventDetail } from '@spark-outpost/contracts';

export interface AgentEventDetail {
  event: HelperEvent;
  notes: string;
  attendees: string[];
  others: number;
  alarmMinutes: number | null;
}

export class CalendarAgentError extends Error {}

export function helperAgentDetail(detail: HelperEventDetail): AgentEventDetail {
  const others = detail.attendees.filter((attendee) => !attendee.isMe);
  return {
    event: detail.event,
    notes: detail.notes,
    attendees: others.map((attendee) => attendee.name.trim()).filter(Boolean),
    others: others.length,
    alarmMinutes: detail.alarms?.[0] ?? null,
  };
}
