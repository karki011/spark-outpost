import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  CALENDAR_PRESETS,
  formatIsoLocal,
  isCappedOut,
  isFutureIso,
  parseIsoLocal,
} from './date-math.ts';
import './calendar-popover.css';

interface CalendarPopoverProps {
  from: string;
  to: string;
  today: string;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  id: string;
}

function useIsNarrow(breakpoint = 640): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === 'function' && matchMedia(`(max-width: ${breakpoint}px)`).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [breakpoint]);
  return narrow;
}

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

export function CalendarPopover({
  from,
  to,
  today,
  onApply,
  onCancel,
  panelRef,
  id,
}: CalendarPopoverProps) {
  const narrow = useIsNarrow();
  const headingId = useId();
  const [draft, setDraft] = useState<DateRange | undefined>({
    from: parseIsoLocal(from),
    to: parseIsoLocal(to),
  });
  const firstFieldRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const onTrapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const container = panelRef.current;
    if (!container) return;
    const focusable = focusableIn(container);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const anchorIso = draft?.from
    ? formatIsoLocal(draft.from)
    : draft?.to
      ? formatIsoLocal(draft.to)
      : undefined;
  const disabled = (date: Date) => {
    const iso = formatIsoLocal(date);
    if (isFutureIso(iso, today)) return true;
    if (draft?.from && !draft?.to && isCappedOut(formatIsoLocal(draft.from), iso)) return true;
    return false;
  };

  const applyPreset = (presetFrom: string, presetTo: string) => {
    setDraft({ from: parseIsoLocal(presetFrom), to: parseIsoLocal(presetTo) });
    onApply(presetFrom, presetTo);
  };

  const canApply = Boolean(draft?.from && draft?.to);

  return (
    <div
      id={id}
      ref={panelRef}
      className="an-cal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onKeyDown={onTrapKeyDown}
    >
      <div className="an-cal-body">
        <div className="an-cal-presets" role="group" aria-label="Quick ranges">
          <h2 id={headingId} className="sr-only">
            Choose a custom date range
          </h2>
          {CALENDAR_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              ref={index === 0 ? firstFieldRef : undefined}
              type="button"
              className="an-cal-preset"
              onClick={() => {
                const range = preset.range(today);
                applyPreset(range.from, range.to);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <DayPicker
          mode="range"
          numberOfMonths={narrow ? 1 : 2}
          selected={draft}
          onSelect={setDraft}
          disabled={disabled}
          defaultMonth={draft?.from ?? parseIsoLocal(today)}
          today={parseIsoLocal(today)}
          showOutsideDays
          fixedWeeks
          className="an-cal-grid"
        />
      </div>
      {anchorIso && draft?.from && !draft?.to && (
        <p className="an-cal-hint">Pick an end date within 366 days of {anchorIso}.</p>
      )}
      <div className="an-cal-foot">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={!canApply}
          onClick={() => {
            if (draft?.from && draft?.to) {
              const a = formatIsoLocal(draft.from);
              const b = formatIsoLocal(draft.to);
              onApply(a <= b ? a : b, a <= b ? b : a);
            }
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
