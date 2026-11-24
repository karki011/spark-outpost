import {
  CALENDAR_CARD_NOTES_MAX,
  type CalendarChoice,
  type CalendarEditOp,
  type CalendarEditSpan,
  type CalendarEventFacts,
  type CalendarEventFields,
  type CalendarFloorReason,
} from '@spark-outpost/contracts';
import type { AgentEventDetail } from './detail.ts';

export function isSynced(choice: CalendarChoice): boolean {
  return choice.sourceKind !== 'local';
}

export interface EditRefusalFacts {
  choice: CalendarChoice;
  cloudCanEdit: boolean;
  span: CalendarEditSpan;
}

const CLOUD: Record<string, { name: string; app: string }> = {
  google: { name: 'Google', app: 'Google Calendar' },
  microsoft: { name: 'Microsoft', app: 'Outlook' },
};

export function editRefusal({ choice, cloudCanEdit, span }: EditRefusalFacts): string | null {
  if (!choice.agentsEdit) {
    return `Agents can’t change ${choice.title}. The user can turn on Agents can edit for it on the Calendar card in Settings → Connectors → Calendar.`;
  }
  if (!choice.writable) return `${choice.title} is read-only, so nothing can change it.`;
  const cloud = CLOUD[choice.sourceKind];
  if (!cloud) return null;
  if (!cloudCanEdit) {
    return `Spark can’t change events on this ${cloud.name} account yet. Ask the user to turn on Agents can edit for this calendar on the Calendar card and allow it in ${cloud.name}.`;
  }
  if (span === 'future') {
    return `On a ${cloud.name} calendar Spark changes one occurrence at a time. Change this occurrence only, or ask the user to change the series in ${cloud.app}.`;
  }
  return null;
}

export function othersRefusal(choice: CalendarChoice, others: number): string | null {
  if (choice.sourceKind !== 'microsoft' || others === 0) return null;
  return 'Microsoft tells attendees about every change to a meeting, so Spark doesn’t change or delete Microsoft events with other people on them. Ask the user to change it in Outlook.';
}

export function floorReasons(
  op: CalendarEditOp,
  choice: CalendarChoice,
  others: number,
): CalendarFloorReason[] {
  const reasons: CalendarFloorReason[] = [];
  if (others > 0) reasons.push('others');
  if (choice.ownership !== 'mine') reasons.push('shared');
  return reasons;
}

function clipNotes(notes: string): string | null {
  const trimmed = notes.trim();
  return trimmed ? trimmed.slice(0, CALENDAR_CARD_NOTES_MAX) : null;
}

export function factsOf(detail: AgentEventDetail): CalendarEventFacts {
  return {
    title: detail.event.title,
    start: detail.event.start,
    end: detail.event.end,
    allDay: detail.event.allDay,
    location: detail.event.location,
    notes: clipNotes(detail.notes),
    alarmMinutes: detail.alarmMinutes,
    others: detail.others,
    recurring: detail.event.recurring,
  };
}

export function completeFields(
  fields: CalendarEventFields,
  before: CalendarEventFacts | null,
): CalendarEventFields {
  if (!before || fields.start === undefined || fields.end !== undefined) return fields;
  const duration = Date.parse(before.end) - Date.parse(before.start);
  return { ...fields, end: new Date(Date.parse(fields.start) + duration).toISOString() };
}

export function newEventProblem(fields: CalendarEventFields): string | null {
  if (!fields.title?.trim()) return 'Pass title for a new event.';
  if (!fields.start || !fields.end) return 'Pass start and end for a new event.';
  return null;
}

export function timesProblem(facts: CalendarEventFacts): string | null {
  return Date.parse(facts.end) > Date.parse(facts.start)
    ? null
    : 'The end must be after the start.';
}

export function factsAfter(
  before: CalendarEventFacts | null,
  fields: CalendarEventFields,
): CalendarEventFacts {
  const base: CalendarEventFacts = before ?? {
    title: '',
    start: fields.start!,
    end: fields.end!,
    allDay: false,
    location: null,
    notes: null,
    alarmMinutes: null,
    others: 0,
    recurring: false,
  };
  return {
    ...base,
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.start !== undefined ? { start: fields.start } : {}),
    ...(fields.end !== undefined ? { end: fields.end } : {}),
    ...(fields.allDay !== undefined ? { allDay: fields.allDay } : {}),
    ...(fields.location !== undefined ? { location: fields.location.trim() || null } : {}),
    ...(fields.notes !== undefined ? { notes: clipNotes(fields.notes) } : {}),
    ...(fields.alarmMinutes !== undefined ? { alarmMinutes: fields.alarmMinutes } : {}),
  };
}

export function sameEvent(a: CalendarEventFacts, b: CalendarEventFacts): boolean {
  return (
    a.title === b.title &&
    Date.parse(a.start) === Date.parse(b.start) &&
    Date.parse(a.end) === Date.parse(b.end) &&
    a.allDay === b.allDay &&
    a.others === b.others
  );
}
