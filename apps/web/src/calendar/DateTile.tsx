import { dateOf } from './calendar-format.ts';

export function DateTile({ date }: { date: string }) {
  const day = dateOf(date);
  return (
    <span className="cal-tile" aria-hidden="true">
      <span>{day.toLocaleDateString(undefined, { month: 'short' })}</span>
      <b>{day.getDate()}</b>
    </span>
  );
}
