import { useId } from 'react';
import type { AnalyticsRange } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import type { RangeChoice } from './analytics-api.ts';

const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' },
];

export function localToday(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

interface RangePickerProps {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}

export function RangePicker({ value, onChange }: RangePickerProps) {
  const id = useId();
  const invalid = value.range === 'custom' && value.from > value.to;
  return (
    <div className="an-range">
      <Segmented
        ariaLabel="Time range"
        options={RANGES}
        value={value.range}
        onChange={(range) => onChange({ ...value, range: range as AnalyticsRange })}
      />
      {value.range === 'custom' && (
        <div className="an-dates">
          <label htmlFor={`${id}-from`}>From</label>
          <input
            id={`${id}-from`}
            className="inp"
            type="date"
            value={value.from}
            max={value.to}
            onChange={(event) =>
              event.target.value && onChange({ ...value, from: event.target.value })
            }
          />
          <label htmlFor={`${id}-to`}>To</label>
          <input
            id={`${id}-to`}
            className="inp"
            type="date"
            value={value.to}
            min={value.from}
            max={localToday()}
            onChange={(event) =>
              event.target.value && onChange({ ...value, to: event.target.value })
            }
          />
          {invalid && <span role="alert">The start date must be on or before the end date.</span>}
        </div>
      )}
    </div>
  );
}
