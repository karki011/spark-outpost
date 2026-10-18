import type {
  CalendarAction,
  CalendarEditAction,
  CalendarEventFacts,
  SparkAction,
} from '@spark-outpost/contracts';
import { span } from '../../calendar/calendar-format.ts';

function isCalendar(action: SparkAction): action is CalendarAction {
  return action.action === 'calendar_read' || action.action === 'calendar_edit';
}

function day(at: string): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function eventWhen(facts: CalendarEventFacts): string {
  if (facts.allDay) return `${day(facts.start)}, all day`;
  return `${day(facts.start)}, ${span(Date.parse(facts.start), Date.parse(facts.end))}`;
}

function alarm(minutes: number | null): string {
  return minutes === null ? 'None' : `${minutes} min before`;
}

interface Line {
  label: string;
  value: (facts: CalendarEventFacts) => string;
}

const LINES: readonly Line[] = [
  { label: 'Title', value: (facts) => facts.title || '(No title)' },
  { label: 'When', value: eventWhen },
  { label: 'Where', value: (facts) => facts.location ?? 'None' },
  { label: 'Notes', value: (facts) => facts.notes ?? 'None' },
  { label: 'Alarm', value: (facts) => alarm(facts.alarmMinutes) },
];

function Change({ line, action }: { line: Line; action: CalendarEditAction }) {
  const before = action.before ? line.value(action.before) : null;
  const after = action.after ? line.value(action.after) : null;
  if (before !== null && after !== null) {
    if (before === after) return null;
    return (
      <>
        <dt>{line.label}</dt>
        <dd>
          <s>{before}</s> → <b>{after}</b>
        </dd>
      </>
    );
  }
  const only = after ?? before;
  if (only === null || (only === 'None' && line.label !== 'Title')) return null;
  return (
    <>
      <dt>{line.label}</dt>
      <dd>{only}</dd>
    </>
  );
}

function spanLine(action: CalendarEditAction): string | null {
  if (!(action.before?.recurring ?? false)) return null;
  return action.span === 'future' ? 'This and future occurrences' : 'This occurrence only';
}

export function CalendarFacts({ action }: { action: CalendarAction }) {
  if (action.action === 'calendar_read') {
    return (
      <dl className="sac-facts">
        <dt>Reads</dt>
        <dd>{action.what}</dd>
      </dl>
    );
  }
  const repeat = spanLine(action);
  const others = action.before?.others ?? 0;
  return (
    <dl className="sac-facts">
      <dt>Calendar</dt>
      <dd>
        {action.calendar.title} ({action.calendar.account})
      </dd>
      {action.op === 'update' && action.before && (
        <>
          <dt>Event</dt>
          <dd>{action.before.title || '(No title)'}</dd>
        </>
      )}
      {LINES.map((line) => (
        <Change key={line.label} line={line} action={action} />
      ))}
      {repeat && (
        <>
          <dt>Repeats</dt>
          <dd>{repeat}</dd>
        </>
      )}
      {others > 0 && (
        <>
          <dt>People</dt>
          <dd>
            {others} other {others === 1 ? 'person' : 'people'}, not told by Spark
          </dd>
        </>
      )}
    </dl>
  );
}

export function calendarByline(action: SparkAction, agent: string): string | null {
  if (!isCalendar(action)) return null;
  if (action.action === 'calendar_read') return `${agent} wants to read your calendar.`;
  if (action.op === 'create') return `${agent} wants to add an event.`;
  if (action.op === 'delete') return `${agent} wants to delete an event.`;
  return `${agent} wants to change an event.`;
}

const FLOOR_NOTES: Record<CalendarEditAction['floor'][number], string> = {
  delete: 'Spark asks before every delete, in every mode.',
  others: 'This event has other people, so Spark asks in every mode.',
  shared: 'This calendar is shared or Spark can’t tell who owns it, so Spark asks in every mode.',
};

export function calendarNote(action: SparkAction): string | null {
  if (!isCalendar(action)) return null;
  if (action.action === 'calendar_read') {
    return 'What the agent reads goes to its model provider, and Spark treats it as untrusted. Allowing covers reading your calendar for the rest of this chat.';
  }
  const synced = action.calendar.synced
    ? ' The change syncs to this calendar’s server.'
    : ' The calendar is on this Mac only.';
  const floor = action.floor.map((reason) => FLOOR_NOTES[reason]).join(' ');
  return `Nothing changes until you confirm.${synced}${floor ? ` ${floor}` : ''}`;
}
