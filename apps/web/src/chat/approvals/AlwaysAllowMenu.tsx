import '../../conversations/chat-menu.css';
import { useState } from 'react';
import { MenuItem, MenuShell, type MenuAnchor } from '../../conversations/MenuShell.tsx';
import { anchorFor } from '../../conversations/menu-anchor.ts';
import type { AlwaysChoice } from './answer-choices.ts';

interface AlwaysAllowProps {
  choices: readonly AlwaysChoice[];
  disabled: boolean;
  onChoose: (choice: AlwaysChoice) => void;
}

function DownIcon() {
  return (
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
  );
}

function AlwaysButton({
  choice,
  disabled,
  onChoose,
}: Omit<AlwaysAllowProps, 'choices'> & {
  choice: AlwaysChoice;
}) {
  return (
    <button
      type="button"
      className="btn line sm"
      disabled={disabled || Boolean(choice.unavailableReason)}
      title={choice.unavailableReason}
      onClick={() => onChoose(choice)}
    >
      {choice.label}
    </button>
  );
}

export function AlwaysAllow({ choices, disabled, onChoose }: AlwaysAllowProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [only] = choices;
  if (!only) return null;
  if (choices.length === 1) {
    return <AlwaysButton choice={only} disabled={disabled} onChoose={onChoose} />;
  }
  const close = () => {
    menu?.focusBack?.focus();
    setMenu(null);
  };
  return (
    <>
      <button
        type="button"
        className="btn line sm appr-always"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        disabled={disabled}
        onClick={(event) => setMenu(menu ? null : anchorFor(event.currentTarget, null))}
      >
        Always allow
        <DownIcon />
      </button>
      {menu && (
        <MenuShell anchor={menu} label="Always allow" page="main" onClose={close}>
          {choices.map((choice) => (
            <MenuItem
              key={`${choice.optionId}:${choice.scope}`}
              label={choice.label}
              disabled={Boolean(choice.unavailableReason)}
              title={choice.unavailableReason}
              onSelect={() => {
                close();
                onChoose(choice);
              }}
            />
          ))}
        </MenuShell>
      )}
    </>
  );
}
