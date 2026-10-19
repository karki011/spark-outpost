import '../conversations/chat-menu.css';
import { useState } from 'react';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { CloudIcon, LaptopIcon, PlusIcon } from '../ui/icons.tsx';
import { GOOGLE_CALENDAR } from './GoogleSource.tsx';
import { MAC_CALENDAR } from './MacSource.tsx';

export const ADD_CALENDAR_LABEL = 'Add calendar';

interface AddCalendarProps {
  onMac: (() => void) | null;
  onGoogle: (() => void) | null;
  disabled: boolean;
}

export function AddCalendar({ onMac, onGoogle, disabled }: AddCalendarProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  if (!onMac && !onGoogle) return null;
  const close = () => {
    menu?.focusBack?.focus();
    setMenu(null);
  };
  const pick = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <>
      <button
        type="button"
        className="btn line sm"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        disabled={disabled}
        onClick={(event) => setMenu(menu ? null : anchorFor(event.currentTarget, null))}
      >
        <PlusIcon />
        {ADD_CALENDAR_LABEL}
      </button>
      {menu && (
        <MenuShell
          anchor={menu}
          label={ADD_CALENDAR_LABEL}
          page="main"
          className="cal-menu"
          onClose={close}
        >
          {onMac && <MenuItem icon={<LaptopIcon />} label={MAC_CALENDAR} onSelect={pick(onMac)} />}
          {onGoogle && (
            <MenuItem icon={<CloudIcon />} label={GOOGLE_CALENDAR} onSelect={pick(onGoogle)} />
          )}
        </MenuShell>
      )}
    </>
  );
}
