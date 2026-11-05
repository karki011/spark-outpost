import '../audit/audit.css';
import { useEffect, useId, type KeyboardEvent, type RefObject } from 'react';
import { CopyIcon, DotsIcon, RefreshIcon, XIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { usePopover } from '../ui/use-popover.ts';

const ITEMS = '[role="menuitem"]';

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

interface TerminalMenuProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onCopyPath: (() => void) | null;
  onReconnect: (() => void) | null;
  onStop: (() => void) | null;
}

export function TerminalMenu({ buttonRef, onCopyPath, onReconnect, onStop }: TerminalMenuProps) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const tip = useTooltip('Terminal actions');
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, [open, panelRef]);
  const choose = (action: () => void) => () => {
    setOpen(false);
    anchorRef.current?.focus();
    action();
  };
  const attach = (node: HTMLButtonElement | null) => {
    anchorRef.current = node;
    buttonRef.current = node;
  };
  return (
    <div className="head-menu">
      {tip.tooltip}
      <button
        ref={attach}
        type="button"
        className="icon-btn"
        aria-label="Terminal actions"
        {...tip.triggerProps}
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
        <DotsIcon />
      </button>
      {open && (
        <div ref={panelRef} id={menuId} className="head-menu-pop" role="menu" onKeyDown={moveFocus}>
          <button
            type="button"
            role="menuitem"
            disabled={!onCopyPath}
            onClick={choose(() => onCopyPath?.())}
          >
            <CopyIcon />
            Copy folder path
          </button>
          {onReconnect && (
            <button type="button" role="menuitem" onClick={choose(onReconnect)}>
              <RefreshIcon />
              Reconnect
            </button>
          )}
          {onStop && (
            <>
              <div className="head-menu-sep" role="separator" />
              <button type="button" role="menuitem" onClick={choose(onStop)}>
                <XIcon />
                Stop session
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
