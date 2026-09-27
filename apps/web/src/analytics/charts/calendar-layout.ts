export interface CalendarDay {
  date: string;
  value: number;
}

export interface CalendarCell extends CalendarDay {
  col: number;
  row: number;
}

export interface CalendarLayout {
  cells: CalendarCell[];
  weeks: number;
  months: { col: number; label: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function calendarLayout(days: readonly CalendarDay[]): CalendarLayout {
  if (days.length === 0) return { cells: [], weeks: 0, months: [] };
  const offset = weekdayIndex(days[0]!.date);
  const cells = days.map((day, index) => ({
    ...day,
    col: Math.floor((index + offset) / 7),
    row: (index + offset) % 7,
  }));
  const months: CalendarLayout['months'] = [];
  let previous = '';
  for (const cell of cells) {
    const label = MONTHS[Number(cell.date.slice(5, 7)) - 1]!;
    if (label === previous) continue;
    previous = label;
    const last = months.at(-1);
    if (last && cell.col - last.col < 3) months.pop();
    months.push({ col: cell.col, label });
  }
  return { cells, weeks: cells.at(-1)!.col + 1, months };
}
