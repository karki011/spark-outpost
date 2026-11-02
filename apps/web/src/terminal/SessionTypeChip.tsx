import { useEffect, useId, type KeyboardEvent } from 'react';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { CheckIcon, CommentIcon, TerminalIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import type { SessionChoice } from './SessionTypePicker.tsx';

const TYPES = [
  { id: 'chat', label: 'Chat', note: 'Spark runs the agent and shows its work here' },
  { id: 'terminal', label: 'Terminal', note: 'The agent’s own interface in a terminal' },
] as const;

function TypeIcon({ type }: { type: SessionChoice['sessionType'] }) {
  return type === 'chat' ? <CommentIcon /> : <TerminalIcon />;
}

export function SessionTypeChip({
  value,
  onChange,
  disabled = false,
}: {
  value: SessionChoice;
  onChange: (value: SessionChoice) => void;
  disabled?: boolean;
}) {
  const { remote } = useRemoteClient();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const current = TYPES.find((type) => type.id === value.sessionType) ?? TYPES[0];

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open, panelRef]);

  if (remote) return null;

  const choose = (sessionType: SessionChoice['sessionType']) => {
    setOpen(false);
    anchorRef.current?.focus();
    if (sessionType !== value.sessionType) onChange({ ...value, sessionType });
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="session-chip-wrap">
      <button
        ref={anchorRef}
        type="button"
        className="session-chip"
        aria-label={`Session type: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={toggle}
      >
        <TypeIcon type={current.id} />
        <span>{current.label}</span>
      </button>
      <div
        ref={panelRef}
        id={menuId}
        className={open ? 'mpop left open session-menu' : 'mpop left session-menu'}
        role="menu"
        aria-label="Session type"
        onKeyDown={moveFocus}
      >
        {TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className="mopt"
            role="menuitemradio"
            aria-checked={type.id === value.sessionType}
            onClick={() => choose(type.id)}
          >
            <span className="mi" aria-hidden="true">
              <TypeIcon type={type.id} />
            </span>
            <span>
              <b>{type.label}</b>
              <small>{type.note}</small>
            </span>
            <span className="tick" aria-hidden="true">
              <CheckIcon />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
