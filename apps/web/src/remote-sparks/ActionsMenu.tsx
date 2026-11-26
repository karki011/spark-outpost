import { useRef, useState, type ReactNode, type RefObject } from 'react';
import '../conversations/chat-menu.css';
import { MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { DotsIcon } from '../ui/icons.tsx';

const MENU_WIDTH = 212;

interface ActionsMenuProps {
  label: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  children: (dismiss: () => void) => ReactNode;
}

export function ActionsMenu({ label, buttonRef, children }: ActionsMenuProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = () => {
    setAnchor(null);
    buttonRef.current?.focus();
  };
  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.right - MENU_WIDTH,
      y: rect.bottom + 4,
      above: rect.top - 4,
      focusBack: buttonRef.current,
    });
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn ph-device-menu"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => (anchor ? close() : open())}
      >
        <DotsIcon />
      </button>
      {anchor && (
        <MenuShell anchor={anchor} label={label} page="main" onClose={close}>
          {children(() => setAnchor(null))}
        </MenuShell>
      )}
    </>
  );
}

export function useActionsButton() {
  const button = useRef<HTMLButtonElement>(null);
  const focus = () => requestAnimationFrame(() => button.current?.focus());
  return { button, focus };
}
