export const SNOOZE_MS = 2 * 60_000;

export interface NudgeMark {
  end: number;
  dismissed: boolean;
  snoozedUntil: number | null;
}

export type NudgeMarks = ReadonlyMap<string, NudgeMark>;

export const NO_NUDGE_MARKS: NudgeMarks = new Map();

export function dismissNudge(marks: NudgeMarks, eventKey: string, end: number): NudgeMarks {
  return new Map(marks).set(eventKey, { end, dismissed: true, snoozedUntil: null });
}

export function snoozeNudge(
  marks: NudgeMarks,
  eventKey: string,
  end: number,
  at: number,
): NudgeMarks {
  return snoozeNudgeFor(marks, eventKey, end, at, SNOOZE_MS);
}

export function snoozeNudgeUntilStart(
  marks: NudgeMarks,
  eventKey: string,
  span: { start: number; end: number },
  at: number,
): NudgeMarks {
  if (span.start <= at || span.end <= at) return marks;
  return snoozeNudgeFor(marks, eventKey, span.end, at, span.start - at);
}

export function snoozeNudgeFor(
  marks: NudgeMarks,
  eventKey: string,
  end: number,
  at: number,
  ms: number,
): NudgeMarks {
  return new Map(marks).set(eventKey, { end, dismissed: false, snoozedUntil: at + ms });
}

export function nudgeHidden(marks: NudgeMarks, eventKey: string, at: number): boolean {
  const mark = marks.get(eventKey);
  if (!mark) return false;
  return mark.dismissed || (mark.snoozedUntil !== null && at < mark.snoozedUntil);
}

export function withJoined(marks: NudgeMarks, joined: ReadonlySet<string>): NudgeMarks {
  if (joined.size === 0) return marks;
  const next = new Map(marks);
  for (const key of joined) next.set(key, { end: Infinity, dismissed: true, snoozedUntil: null });
  return next;
}

export function purgeMarks(marks: NudgeMarks, at: number): NudgeMarks {
  const kept = [...marks].filter(([, mark]) => mark.end > at);
  return kept.length === marks.size ? marks : new Map(kept);
}

export function snoozeEnds(marks: NudgeMarks): number[] {
  return [...marks.values()].flatMap((mark) =>
    mark.snoozedUntil === null ? [] : [mark.snoozedUntil],
  );
}

export function withServerDismissed(
  marks: NudgeMarks,
  events: readonly { key: string; end: string; dismissed: boolean }[],
): NudgeMarks {
  const dismissed = events.filter(
    (event) => event.dismissed && marks.get(event.key)?.dismissed !== true,
  );
  if (dismissed.length === 0) return marks;
  const next = new Map(marks);
  for (const event of dismissed) {
    next.set(event.key, { end: Date.parse(event.end), dismissed: true, snoozedUntil: null });
  }
  return next;
}

export function withJoinAtStart(
  marks: NudgeMarks,
  events: readonly { key: string; start: string; end: string; joinAtStart: boolean }[],
): NudgeMarks {
  const asked = events.filter((event) => event.joinAtStart && !marks.get(event.key)?.dismissed);
  if (asked.length === 0) return marks;
  const next = new Map(marks);
  for (const event of asked) {
    const until = Math.max(Date.parse(event.start), marks.get(event.key)?.snoozedUntil ?? 0);
    next.set(event.key, { end: Date.parse(event.end), dismissed: false, snoozedUntil: until });
  }
  return next;
}

const SNOOZE_KEY = 'spark-outpost.calendar-snoozes';

export function readSnoozes(at: number): NudgeMarks {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return NO_NUDGE_MARKS;
    const kept = saved.flatMap((entry): [string, NudgeMark][] => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') return [];
      const [key, end, until] = entry as unknown[];
      if (typeof end !== 'number' || typeof until !== 'number' || until <= at) return [];
      return [[key as string, { end, dismissed: false, snoozedUntil: until }]];
    });
    return kept.length > 0 ? new Map(kept) : NO_NUDGE_MARKS;
  } catch {
    return NO_NUDGE_MARKS;
  }
}

export function saveSnoozes(marks: NudgeMarks): void {
  const snoozed = [...marks].flatMap(([key, mark]) =>
    mark.snoozedUntil === null || mark.dismissed ? [] : [[key, mark.end, mark.snoozedUntil]],
  );
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozed));
  } catch {
    return;
  }
}
