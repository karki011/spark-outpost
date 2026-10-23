import '../conversations/chat-menu.css';
import './account-row.css';
import { useRef, useState } from 'react';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { DotsIcon } from '../ui/icons.tsx';
import { DisconnectDialog } from './DisconnectDialog.tsx';

export interface AccountMenuItem {
  label: string;
  onSelect: () => void;
}

interface AccountRowProps {
  name: string;
  place: string;
  account: string;
  items?: readonly AccountMenuItem[];
  disconnectCopy: { title: string; text: string };
  onDisconnect: () => void;
}

export function AccountRow({
  name,
  place,
  account,
  items = [],
  disconnectCopy,
  onDisconnect,
}: AccountRowProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [confirming, setConfirming] = useState(false);
  const label = `Options for ${name}`;
  const focusTrigger = () => triggerRef.current?.focus();
  const choose = (action: () => void) => {
    setMenu(null);
    action();
  };
  return (
    <div className="cx-account">
      <p>
        <b>{place}</b>
        <small>{account}</small>
      </p>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => setMenu(menu ? null : anchorFor(event.currentTarget, null))}
      >
        <DotsIcon />
      </button>
      {menu && (
        <MenuShell
          anchor={menu}
          label={label}
          page="main"
          className="cx-account-menu"
          onClose={() => {
            setMenu(null);
            focusTrigger();
          }}
        >
          {items.map((item) => (
            <MenuItem key={item.label} label={item.label} onSelect={() => choose(item.onSelect)} />
          ))}
          <MenuItem label="Disconnect…" danger onSelect={() => choose(() => setConfirming(true))} />
        </MenuShell>
      )}
      {confirming && (
        <DisconnectDialog
          copy={disconnectCopy}
          onCancel={() => {
            setConfirming(false);
            focusTrigger();
          }}
          onConfirm={() => {
            setConfirming(false);
            onDisconnect();
          }}
        />
      )}
    </div>
  );
}
