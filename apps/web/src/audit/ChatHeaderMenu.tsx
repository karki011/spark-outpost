import './audit.css';
import { useEffect, useId, type KeyboardEvent, type ReactNode } from 'react';
import { useCopyChatLink } from '../conversations/use-copy-chat-link.tsx';
import { CopyIcon, DotsIcon, RestoreIcon, ShieldIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { useTooltip } from '../ui/Tooltip.tsx';

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export interface ChatMenuExtra {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ChatHeaderMenuProps {
  chatId: string;
  onAudit?: (() => void) | undefined;
  onStartFresh?: (() => void) | undefined;
  extras?: readonly ChatMenuExtra[];
}

export function ChatHeaderMenu({
  chatId,
  onAudit,
  onStartFresh,
  extras = [],
}: ChatHeaderMenuProps) {
  const link = useCopyChatLink(chatId);
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const tip = useTooltip('Chat actions');
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, panelRef]);
  return (
    <div className="head-menu">
      {tip.tooltip}
      {link.toast}
      <button
        ref={anchorRef}
        type="button"
        className="icon-btn"
        aria-label="Chat actions"
        {...tip.triggerProps}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
      >
        <DotsIcon />
      </button>
      {open && (
        <div ref={panelRef} id={menuId} className="head-menu-pop" role="menu" onKeyDown={moveFocus}>
          {onAudit && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
                onAudit();
              }}
            >
              <ShieldIcon />
              Audit this chat
            </button>
          )}
          {onStartFresh && (
            <button
              type="button"
              role="menuitem"
              title="The next reply starts a new agent session and resends the chat history"
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
                onStartFresh();
              }}
            >
              <RestoreIcon />
              Start fresh
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              anchorRef.current?.focus();
              link.copy();
            }}
          >
            <CopyIcon />
            Copy chat link
          </button>
          {extras.map((extra) => (
            <button
              key={extra.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                anchorRef.current?.focus();
                extra.onSelect();
              }}
            >
              {extra.icon}
              {extra.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
