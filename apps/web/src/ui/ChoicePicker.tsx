import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon } from './icons.tsx';
import { usePopover } from './use-popover.ts';

export interface PickerChoice {
  id: string;
  label: string;
  description?: string;
  risky?: boolean;
  unavailableReason?: string | null;
}

interface ChoicePickerProps {
  label: string;
  choices: readonly PickerChoice[];
  value: string;
  placeholder?: string;
  onChange: (id: string) => void;
}

const GAP = 6;
const MENU_MAX_HEIGHT = 320;

export function ChoicePicker({
  label,
  choices,
  value,
  placeholder = 'Choose',
  onChange,
}: ChoicePickerProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const [position, setPosition] = useState<CSSProperties>({});
  const listId = useId();
  const current = choices.find((choice) => choice.id === value);

  const place = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const upward = below < Math.min(MENU_MAX_HEIGHT, 60 * choices.length) && rect.top > below;
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(upward
        ? { bottom: window.innerHeight - rect.top + GAP, transformOrigin: 'bottom center' }
        : { top: rect.bottom + GAP, transformOrigin: 'top center' }),
      maxHeight: Math.min(MENU_MAX_HEIGHT, (upward ? rect.top : below) - GAP * 3),
    });
  }, [anchorRef, choices.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const follow = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, panelRef, place]);

  const moveFocus = (delta: number) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + delta + items.length) % items.length]?.focus();
  };

  return (
    <div className="choice-picker">
      <button
        ref={anchorRef}
        type="button"
        className={`field-button${current?.risky ? ' warn' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
      >
        <span className="field-value">{current?.label ?? placeholder}</span>
        <ChevronIcon />
      </button>
      {current?.description && (
        <small className={current.risky ? 'note warn' : 'note'}>{current.description}</small>
      )}
      {createPortal(
        <div
          ref={panelRef}
          id={listId}
          role="menu"
          aria-label={label}
          className={open ? 'choice-menu open' : 'choice-menu'}
          style={position}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            }
          }}
        >
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitemradio"
              aria-checked={choice.id === value}
              className={choice.risky ? 'warn' : undefined}
              disabled={Boolean(choice.unavailableReason)}
              onClick={() => {
                onChange(choice.id);
                setOpen(false);
                anchorRef.current?.focus();
              }}
            >
              <span>
                <b>{choice.label}</b>
                {(choice.unavailableReason ?? choice.description) && (
                  <small>{choice.unavailableReason ?? choice.description}</small>
                )}
              </span>
              <svg className="tick" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m5 12 5 5 9-10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
