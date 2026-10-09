import './field-popover.css';
import { useEffect, useId, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon } from '../../ui/icons.tsx';
import { MENU_MAX_HEIGHT, useMenuPosition } from '../../ui/use-menu-position.ts';
import { usePopover } from '../../ui/use-popover.ts';

interface FieldPopoverProps {
  label: string;
  value: ReactNode;
  invalid?: boolean;
  describedBy?: string | undefined;
  disabled?: boolean;
  children: ReactNode;
}

const OPTIONS = 'button:not(:disabled)';
const CHOICE = '[role="radio"]';

export function FieldPopover({
  label,
  value,
  invalid = false,
  describedBy,
  disabled = false,
  children,
}: FieldPopoverProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const panelId = useId();
  const position = useMenuPosition({ open, anchorRef, panelRef, wantedHeight: MENU_MAX_HEIGHT });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const checked = panel?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    (checked ?? panel?.querySelector<HTMLElement>(OPTIONS))?.focus();
  }, [open, panelRef]);

  const close = () => {
    setOpen(false);
    anchorRef.current?.focus();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(CHOICE)) close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(OPTIONS)];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="choice-picker">
      <button
        ref={anchorRef}
        type="button"
        className="field-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="field-value op-field-value">{value}</span>
        <ChevronIcon />
      </button>
      {createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          className={open ? 'op-pop open' : 'op-pop'}
          style={position}
          onClick={onClick}
          onKeyDown={onKeyDown}
        >
          {open && children}
        </div>,
        document.body,
      )}
    </div>
  );
}
