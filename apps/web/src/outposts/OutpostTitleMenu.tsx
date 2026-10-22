import '../audit/audit.css';
import { useEffect, useId, type KeyboardEvent } from 'react';
import { ChevronIcon, TickIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]';

interface OutpostTitleMenuProps {
  name: string;
  overviewOpen: boolean | null;
  onRename: () => void;
  onSettings: () => void;
  onInstructions: () => void;
  onToggleOverview: () => void;
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export function OutpostTitleMenu({
  name,
  overviewOpen,
  onRename,
  onSettings,
  onInstructions,
  onToggleOverview,
}: OutpostTitleMenuProps) {
  const menuId = useId();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open, panelRef]);
  const choose = (action: () => void) => () => {
    setOpen(false);
    anchorRef.current?.focus();
    action();
  };
  return (
    <div className="head-menu op-title-menu">
      <h1 className="chat-title">
        <button
          ref={anchorRef}
          type="button"
          className="op-title-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            setOpen(true);
          }}
        >
          <span className="op-title-text">{name}</span>
          <ChevronIcon />
        </button>
      </h1>
      {open && (
        <div ref={panelRef} id={menuId} className="head-menu-pop" role="menu" onKeyDown={moveFocus}>
          <button type="button" role="menuitem" onClick={choose(onRename)}>
            Rename…
          </button>
          <button type="button" role="menuitem" onClick={choose(onSettings)}>
            Outpost Settings…
          </button>
          <button type="button" role="menuitem" onClick={choose(onInstructions)}>
            Instructions…
          </button>
          {overviewOpen !== null && (
            <>
              <div className="head-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={overviewOpen}
                onClick={choose(onToggleOverview)}
              >
                Show Overview
                <span className="head-menu-end">{overviewOpen && <TickIcon />}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
