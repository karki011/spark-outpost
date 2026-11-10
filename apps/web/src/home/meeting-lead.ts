import { isMeeting, spanOf, type CalendarEvent } from '@spark-outpost/contracts';

export const STARTED_GRACE_MS = 5 * 60_000;

export function leadMeeting(
  events: readonly CalendarEvent[],
  now: number,
  leadMs: number,
  hidden: (eventKey: string) => boolean,
): CalendarEvent | null {
  const inside = events.filter((event) => {
    const { start, end } = spanOf(event);
    const closes = Math.min(end, start + STARTED_GRACE_MS);
    return (
      isMeeting(event) &&
      event.nudges &&
      !event.dismissed &&
      !hidden(event.key) &&
      now >= start - leadMs &&
      now < closes
    );
  });
  return inside.toSorted((a, b) => spanOf(a).start - spanOf(b).start)[0] ?? null;
}
