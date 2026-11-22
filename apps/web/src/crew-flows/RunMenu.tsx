import { useEffect, useId, type KeyboardEvent } from 'react';
import { ChevronIcon, ResumeIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';

const ITEMS = '[role="menuitem"]';

export interface RunMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
}

interface RunMenuProps {
  items: readonly RunMenuItem[];
  disabled: boolean;
  reason: string | null;
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export function RunMenu({ items, disabled, reason }: RunMenuProps) {
  const menuId = useId();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open, panelRef]);
  return (
    <span className="wf-menu">
      <button
        ref={anchorRef}
        type="button"
        className="btn line sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        title={reason ?? undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <ResumeIcon />
        Run
        <span className="wf-menu-chev" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          className="wf-menu-pop"
          role="menu"
          aria-label="Run"
          onKeyDown={moveFocus}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
