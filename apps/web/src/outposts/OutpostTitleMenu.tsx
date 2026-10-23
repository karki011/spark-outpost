import '../conversations/chat-menu.css';
import { useState } from 'react';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { anchorFor } from '../conversations/menu-anchor.ts';
import { CheckIcon, ChevronIcon } from '../ui/icons.tsx';

interface OutpostTitleMenuProps {
  name: string;
  overviewOpen: boolean | null;
  onRename: () => void;
  onSettings: () => void;
  onInstructions: () => void;
  onToggleOverview: () => void;
}

export function OutpostTitleMenu({
  name,
  overviewOpen,
  onRename,
  onSettings,
  onInstructions,
  onToggleOverview,
}: OutpostTitleMenuProps) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const close = () => {
    menu?.focusBack?.focus();
    setMenu(null);
  };
  const choose = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <div className="op-title-menu">
      <h1 className="chat-title">
        <button
          type="button"
          className="op-title-btn"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(event) => setMenu(menu ? null : anchorFor(event.currentTarget, null))}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' || menu) return;
            event.preventDefault();
            setMenu(anchorFor(event.currentTarget, null));
          }}
        >
          <span className="op-title-text">{name}</span>
          <ChevronIcon />
        </button>
      </h1>
      {menu && (
        <MenuShell anchor={menu} label={name} page="main" className="op-menu" onClose={close}>
          <MenuItem label="Rename…" onSelect={choose(onRename)} />
          <MenuItem label="Outpost Settings…" onSelect={choose(onSettings)} />
          <MenuItem label="Instructions…" onSelect={choose(onInstructions)} />
          {overviewOpen !== null && (
            <>
              <hr />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={overviewOpen}
                onClick={choose(onToggleOverview)}
              >
                <span>Show Overview</span>
                <span className="tk">{overviewOpen && <CheckIcon className="tick" />}</span>
              </button>
            </>
          )}
        </MenuShell>
      )}
    </div>
  );
}
