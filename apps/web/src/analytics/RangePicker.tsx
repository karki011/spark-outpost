import { useId } from 'react';
import type { AnalyticsRange } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { CalendarPopover } from './calendar/CalendarPopover.tsx';
import { formatRangeLabel } from './calendar/date-math.ts';
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
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
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
        <div className="an-dates an-cal-anchor">
          <button
            ref={anchorRef}
            type="button"
            className="an-range-btn"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={`${id}-cal`}
            onClick={toggle}
          >
            {invalid ? 'Choose a range' : formatRangeLabel(value.from, value.to)}
          </button>
          {invalid && <span role="alert">The start date must be on or before the end date.</span>}
          {open && (
            <CalendarPopover
              id={`${id}-cal`}
              from={value.from}
              to={value.to}
              today={localToday()}
              panelRef={panelRef}
              onCancel={() => {
                setOpen(false);
                anchorRef.current?.focus();
              }}
              onApply={(from, to) => {
                onChange({ ...value, from, to });
                setOpen(false);
                anchorRef.current?.focus();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
