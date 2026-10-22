import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon, PlusIcon } from './icons.tsx';
import { useMenuPosition } from './use-menu-position.ts';
import { usePopover } from './use-popover.ts';

export interface PickerChoice {
  id: string;
  label: string;
  description?: string;
  risky?: boolean;
  unavailableReason?: string | null;
}

export interface PickerAction {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface ChoicePickerProps {
  label: string;
  choices: readonly PickerChoice[];
  value: string;
  placeholder?: string;
  actions?: readonly PickerAction[];
  onChange: (id: string) => void;
}

const MENU_ITEMS = '[role="menuitemradio"], [role="menuitem"]';

const ROW_HEIGHT = 60;

export function ChoicePicker({
  label,
  choices,
  value,
  placeholder = 'Choose',
  actions = [],
  onChange,
}: ChoicePickerProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const position = useMenuPosition({
    open,
    anchorRef,
    panelRef,
    wantedHeight: ROW_HEIGHT * (choices.length + actions.length),
  });
  const listId = useId();
  const current = choices.find((choice) => choice.id === value);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const checked = panel?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = panel?.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)',
    );
    (checked ?? first)?.focus();
  }, [open, panelRef]);

  const moveFocus = (delta: number) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? [],
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
          {actions.length > 0 && <div className="choice-sep" role="separator" />}
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="choice-action"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
                action.onSelect();
              }}
            >
              <PlusIcon />
              <span>
                <b>{action.label}</b>
                {action.description && <small>{action.description}</small>}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
