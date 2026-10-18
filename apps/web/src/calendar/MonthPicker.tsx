import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { ChevronIcon } from '../ui/icons.tsx';
import { useDismiss } from '../ui/use-dismiss.ts';
import { StepButtons } from './StepButtons.tsx';

const COLUMNS = 3;

function monthLabel(month: number, style: 'long' | 'short'): string {
  return new Date(2000, month, 1).toLocaleDateString(undefined, { month: style });
}

const MONTHS = Array.from({ length: 12 }, (_, month) => ({
  month,
  short: monthLabel(month, 'short'),
  long: monthLabel(month, 'long'),
}));

const MOVES: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
};

function nextMonthIndex(key: string, index: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return MONTHS.length - 1;
  const move = MOVES[key];
  if (move === undefined) return null;
  return Math.min(MONTHS.length - 1, Math.max(0, index + move));
}

interface MonthPickerProps {
  year: number;
  month: number;
  titleId: string;
  onPick: (year: number, month: number) => void;
}

export function MonthPicker({ year, month, titleId, onPick }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [shownYear, setShownYear] = useState(year);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useDismiss({
    open,
    panelRef,
    anchor: () => anchorRef.current,
    focusBack: () => anchorRef.current,
    onClose: () => setOpen(false),
  });
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const current = panel?.querySelector<HTMLButtonElement>('.mo-month[aria-current="true"]');
    (current ?? panel?.querySelector<HTMLButtonElement>('.mo-month'))?.focus();
  }, [open]);

  const toggle = () => {
    if (!open) setShownYear(year);
    setOpen(!open);
  };
  const pick = (picked: number) => {
    onPick(shownYear, picked);
    setOpen(false);
    anchorRef.current?.focus();
  };
  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node)) return;
    if (panelRef.current?.contains(next) || anchorRef.current?.contains(next)) return;
    setOpen(false);
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.mo-month')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = nextMonthIndex(event.key, index);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div className="mo-title">
      <h1 id={titleId}>
        <button
          ref={anchorRef}
          type="button"
          className="mo-title-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={toggle}
        >
          {monthLabel(month, 'long')} {year}
          <ChevronIcon />
        </button>
      </h1>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="mo-picker"
          role="dialog"
          aria-label="Choose month"
          onBlur={closeWhenFocusLeaves}
        >
          <div className="mo-picker-year">
            <span aria-live="polite">{shownYear}</span>
            <StepButtons unit="year" onStep={(delta) => setShownYear((value) => value + delta)} />
          </div>
          <div
            className="mo-months"
            role="group"
            aria-label={`Months of ${shownYear}`}
            onKeyDown={moveFocus}
          >
            {MONTHS.map((item) => (
              <button
                key={item.month}
                type="button"
                className="mo-month"
                aria-label={`${item.long} ${shownYear}`}
                aria-current={shownYear === year && item.month === month ? 'true' : undefined}
                onClick={() => pick(item.month)}
              >
                {item.short}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
