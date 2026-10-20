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
