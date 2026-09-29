import type { ComponentProps } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import './day-calendar.css';

export type DayCalendarProps = ComponentProps<typeof DayPicker>;

export function DayCalendar({ className, ...props }: DayCalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      fixedWeeks
      {...props}
      className={className ? `day-grid ${className}` : 'day-grid'}
    />
  );
}
