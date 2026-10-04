import { useEffect, useId, type KeyboardEvent } from 'react';
import type { BusyEnterAction } from '@spark-outpost/contracts';
import { MAC } from '../../ui/shortcuts.ts';
import { usePopover } from '../../ui/use-popover.ts';
import { SEND_CHOICES, SEND_CHOICE_ORDER, choiceKey, choiceTitle } from '../queue/send-choice.ts';

interface BusySendButtonProps {
  preferred: BusyEnterAction;
  disabled: boolean;
  onChoice: (action: BusyEnterAction) => void;
}

const MAIN_LABELS: Record<BusyEnterAction, string> = {
  queue: 'Queue message',
  now: 'Send now',
};

const ICON_PATHS: Record<BusyEnterAction, string> = {
  queue: 'M3 4.5h10M3 8h10M3 11.5h5.5M11.5 10v4M9.5 12h4',
  now: 'M3 8h9M8.5 4.5 12 8l-3.5 3.5',
};

const MOVES: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

function ChoiceIcon({ action }: { action: BusyEnterAction }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={ICON_PATHS[action]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BusySendButton({ preferred, disabled, onChoice }: BusySendButtonProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const items = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, panelRef]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const all = items();
    const next = move(all.indexOf(document.activeElement as HTMLElement), all.length);
    all[next]?.focus();
  };

  const choose = (action: BusyEnterAction) => {
    if (disabled) return;
    setOpen(false);
    onChoice(action);
  };

  return (
    <div className="send-split">
      <button
        type="button"
        className="send queue"
        aria-label={MAIN_LABELS[preferred]}
        title={choiceTitle(preferred, preferred, MAC)}
        disabled={disabled}
        onClick={() => onChoice(preferred)}
      >
        <ChoiceIcon action={preferred} />
      </button>
      <button
        ref={anchorRef}
        type="button"
        className="send-caret"
        aria-label="Choose message timing"
        title="Queue or send now"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        ref={panelRef}
        id={menuId}
        className={open ? 'mpop send-menu open' : 'mpop send-menu'}
        role="menu"
        aria-label="Queue or send now"
        onKeyDown={onMenuKey}
      >
        {SEND_CHOICE_ORDER.map((action) => (
          <button
            key={action}
            type="button"
            className="mopt"
            role="menuitem"
            aria-disabled={disabled}
            onClick={() => choose(action)}
          >
            <span className="mi">
              <ChoiceIcon action={action} />
            </span>
            <span className="send-choice">
              <b>{SEND_CHOICES[action].label}</b>
              <small>{SEND_CHOICES[action].note}</small>
            </span>
            <kbd className="send-key">{choiceKey(action, preferred, MAC)}</kbd>
          </button>
        ))}
        {disabled && <p className="switch-note">Type a message first.</p>}
      </div>
    </div>
  );
}
