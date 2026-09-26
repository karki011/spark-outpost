import { useId } from 'react';
import { usePopover } from '../ui/use-popover.ts';

export interface MoreAction {
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}

export function MoreMenu({ label, actions }: { label: string; actions: MoreAction[] }) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  return (
    <div className="more">
      <button
        ref={anchorRef}
        type="button"
        className="more-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label={label}
        className={open ? 'more-menu open' : 'more-menu'}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            className={action.danger ? 'danger' : undefined}
            onClick={() => {
              setOpen(false);
              action.onSelect();
            }}
          >
            <b>{action.label}</b>
            {action.hint && <small>{action.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
