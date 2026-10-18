import type { ReactNode } from 'react';
import { shortDay } from './calendar-format.ts';
import { MonthPicker } from './MonthPicker.tsx';
import { StepButtons } from './StepButtons.tsx';
import { setMonth, shiftMonth, type MonthGridModel } from './month-model.ts';
import { localDate } from './use-calendar.ts';

interface MonthBarProps {
  grid: MonthGridModel;
  date: string;
  today: string;
  titleId: string;
  switcher: ReactNode;
  onDate: (date: string) => void;
}

export function MonthBar({ grid, date, today, titleId, switcher, onDate }: MonthBarProps) {
  return (
    <header className="mo-bar">
      <MonthPicker
        year={grid.year}
        month={grid.month}
        titleId={titleId}
        onPick={(year, month) => onDate(setMonth(date, year, month))}
      />
      <span className="mo-steps">
        <StepButtons unit="month" onStep={(delta) => onDate(shiftMonth(date, delta))} />
      </span>
      <button type="button" className="btn line sm" onClick={() => onDate(localDate(Date.now()))}>
        Today
      </button>
      <p className="mo-now">
        <span className="sr-only">Today is </span>
        {shortDay(today)}
      </p>
      {switcher}
    </header>
  );
}
