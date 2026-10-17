import type { CalendarChoice, HelperCalendar } from '@spark-outpost/contracts';
import type { ChoiceWrite } from './store.ts';

export interface Rematch {
  writes: ChoiceWrite[];
  lost: CalendarChoice[];
  changed: boolean;
}

const nameKey = (sourceTitle: string, title: string) => `${sourceTitle}\u0000${title}`;

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return new Map(
    items.filter((item) => counts.get(key(item)) === 1).map((item) => [key(item), item]),
  );
}

function kept(saved: CalendarChoice, calendar: HelperCalendar): ChoiceWrite {
  return {
    key: saved.key,
    calendar,
    include: saved.include,
    nudges: saved.nudges,
  };
}

function fresh(calendar: HelperCalendar): ChoiceWrite {
  return { key: null, calendar, include: true, nudges: true };
}

function sameFacts(saved: CalendarChoice, calendar: HelperCalendar): boolean {
  return (
    saved.calendarId === calendar.id &&
    saved.title === calendar.title &&
    saved.sourceId === calendar.sourceId &&
    saved.sourceTitle === calendar.sourceTitle &&
    saved.sourceKind === calendar.sourceKind &&
    saved.color === calendar.color &&
    saved.writable === calendar.writable &&
    saved.subscribed === calendar.subscribed &&
    saved.ownership === calendar.ownership
  );
}

export function rematchCalendars(
  saved: readonly CalendarChoice[],
  current: readonly HelperCalendar[],
): Rematch {
  const byId = new Map(saved.map((choice) => [choice.calendarId, choice]));
  const matched = new Map<string, CalendarChoice>();
  for (const calendar of current) {
    const choice = byId.get(calendar.id);
    if (choice) matched.set(calendar.id, choice);
  }
  const usedKeys = new Set([...matched.values()].map((choice) => choice.key));
  const leftSaved = saved.filter((choice) => !usedKeys.has(choice.key));
  const leftCurrent = current.filter((calendar) => !matched.has(calendar.id));
  const savedByName = uniqueBy(leftSaved, (choice) => nameKey(choice.sourceTitle, choice.title));
  const currentByName = uniqueBy(leftCurrent, (calendar) =>
    nameKey(calendar.sourceTitle, calendar.title),
  );
  for (const [name, calendar] of currentByName) {
    const choice = savedByName.get(name);
    if (choice) {
      matched.set(calendar.id, choice);
      usedKeys.add(choice.key);
    }
  }
  const writes = current.map((calendar) => {
    const choice = matched.get(calendar.id);
    return choice ? kept(choice, calendar) : fresh(calendar);
  });
  const lost = saved.filter((choice) => !usedKeys.has(choice.key));
  const changed =
    lost.length > 0 ||
    writes.length !== saved.length ||
    writes.some((write, index) => {
      const choice = saved[index];
      return !choice || write.key !== choice.key || !sameFacts(choice, write.calendar);
    });
  return { writes, lost, changed };
}

export function lostNotice(lost: readonly CalendarChoice[]): string | null {
  if (lost.length === 0) return null;
  const names = lost.map((choice) => `${choice.title} (${choice.sourceTitle})`).join(', ');
  const verb = lost.length === 1 ? 'was' : 'were';
  return `${names} ${verb} not found after a calendar sync, so ${lost.length === 1 ? 'its' : 'their'} choices were reset.`;
}
