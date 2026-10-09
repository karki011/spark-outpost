import './audit.css';
import { useEffect, useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useCopyChatLink } from '../conversations/use-copy-chat-link.tsx';
import { CopyIcon, DotsIcon, RestoreIcon, ShieldIcon, TickIcon } from '../ui/icons.tsx';
import { Keys, type ShortcutKeys } from '../ui/Keys.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { useTooltip } from '../ui/Tooltip.tsx';

export const CHAT_MENU_BUTTON_ID = 'chat-menu-button';

const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]';

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
}

export interface ChatMenuExtra {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface ChatMenuSignal {
  note: string;
  summary: string;
  live: boolean;
}

export interface ChatMenuPane {
  label: string;
  icon: ReactNode;
  open: boolean;
  keys?: ShortcutKeys;
  ariaKeys?: string;
  controls?: string;
  signal?: ChatMenuSignal | null;
  onToggle: () => void;
  onIntent?: () => void;
}

interface ChatHeaderMenuProps {
  chatId: string;
  onAudit?: (() => void) | undefined;
  onStartFresh?: (() => void) | undefined;
  panes?: readonly ChatMenuPane[];
  extras?: readonly ChatMenuExtra[];
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

function signalDot(signals: readonly ChatMenuSignal[]): string {
  return signals.some((signal) => signal.live) ? 'head-menu-dot live' : 'head-menu-dot';
}

export function ChatHeaderMenu({
  chatId,
  onAudit,
  onStartFresh,
  panes = [],
  extras = [],
  buttonRef,
}: ChatHeaderMenuProps) {
  const link = useCopyChatLink(chatId);
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const signals = panes.flatMap((pane) => (pane.signal ? [pane.signal] : []));
  const summaries = signals.map((signal) => signal.summary);
  const tip = useTooltip(['Chat actions', ...summaries].join(' · '));
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
    if (buttonRef) buttonRef.current = node;
  };
  return (
    <div className="head-menu">
      {tip.tooltip}
      {link.toast}
      <button
        ref={attach}
        id={CHAT_MENU_BUTTON_ID}
        type="button"
        className="icon-btn"
        aria-label={['Chat actions', ...summaries].map((part) => `${part}.`).join(' ')}
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
        {signals.length > 0 && <i className={signalDot(signals)} aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panelRef} id={menuId} className="head-menu-pop" role="menu" onKeyDown={moveFocus}>
          {panes.map((pane) => (
            <button
              key={pane.label}
              type="button"
              role="menuitemcheckbox"
              aria-checked={pane.open}
              aria-keyshortcuts={pane.ariaKeys}
              aria-controls={pane.controls}
              onMouseEnter={pane.onIntent}
              onFocus={pane.onIntent}
              onClick={choose(pane.onToggle)}
            >
              {pane.icon}
              {pane.label}
              {pane.signal && (
                <span className="head-menu-note">
                  <i className={signalDot([pane.signal])} aria-hidden="true" />
                  {pane.signal.note}
                </span>
              )}
              <span className="head-menu-end">
                {pane.keys && <Keys keys={pane.keys} className="key-hint" />}
                {pane.open && <TickIcon />}
              </span>
            </button>
          ))}
          {panes.length > 0 && <div className="head-menu-sep" role="separator" />}
          {onAudit && (
            <button type="button" role="menuitem" onClick={choose(onAudit)}>
              <ShieldIcon />
              Audit this chat
            </button>
          )}
          {onStartFresh && (
            <button
              type="button"
              role="menuitem"
              title="The next reply starts a new agent session and resends the chat history"
              onClick={choose(onStartFresh)}
            >
              <RestoreIcon />
              Start fresh
            </button>
          )}
          <button type="button" role="menuitem" onClick={choose(link.copy)}>
            <CopyIcon />
            Copy chat link
          </button>
          {extras.map((extra) => (
            <button
              key={extra.label}
              type="button"
              role="menuitem"
              onClick={choose(extra.onSelect)}
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
