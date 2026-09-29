import { useEffect, useId, useRef } from 'react';
import type { AnalyticsRange } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { CalendarPopover } from './calendar/CalendarPopover.tsx';
import { formatRangeLabel, formatShortRange, localToday } from './calendar/date-math.ts';
import type { RangeChoice } from './analytics-api.ts';

const PRESETS = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
];

interface RangePickerProps {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}

function customLabel(value: RangeChoice, today: string) {
  if (value.range !== 'custom' || value.from > value.to) return 'Custom';
  return (
    <span title={formatRangeLabel(value.from, value.to)}>
      <span className="sr-only">Custom: </span>
      {formatShortRange(value.from, value.to, today)}
    </span>
  );
}

export function RangePicker({ value, onChange }: RangePickerProps) {
  const id = useId();
  const today = localToday();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLDivElement,
    HTMLDivElement
  >();
  const wasOpen = useRef(false);
  const invalid = value.range === 'custom' && value.from > value.to;

  useEffect(() => {
    if (wasOpen.current && !open) {
      anchorRef.current?.querySelector<HTMLButtonElement>('[data-option="custom"]')?.focus();
    }
    wasOpen.current = open;
  }, [open, anchorRef]);

  const pick = (range: string) => {
    if (range === 'custom') {
      toggle();
      return;
    }
    setOpen(false);
    onChange({ ...value, range: range as AnalyticsRange });
  };

  return (
    <div className="an-range">
      <div ref={anchorRef} className="an-cal-anchor" data-calendar={open ? id : undefined}>
        <Segmented
          ariaLabel="Time range"
          options={[...PRESETS, { id: 'custom', label: customLabel(value, today) }]}
          value={value.range}
          onChange={pick}
        />
        {open && (
          <CalendarPopover
            id={`${id}-cal`}
            from={value.from}
            to={value.to}
            today={today}
            panelRef={panelRef}
            onCancel={() => setOpen(false)}
            onApply={(from, to) => {
              onChange({ range: 'custom', from, to });
              setOpen(false);
            }}
          />
        )}
      </div>
      {invalid && (
        <div className="an-dates">
          <span role="alert">The start date must be on or before the end date.</span>
        </div>
      )}
    </div>
  );
}
