import { useState, type MouseEvent } from 'react';
import type { BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { SplitViewIcon } from '../browser/BrowserIcons.tsx';
import { tabLabel } from '../browser/tab-label.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { sendViewCommand } from './view-store.ts';

const OTHER_TABS_SHOWN = 8;

interface SplitButtonProps {
  profile: BrowserProfile;
  tabs: readonly BrowserPaneTab[];
  shown: BrowserPaneTab | null;
  inSplit: boolean;
  disabled: boolean;
  onNewPage(): void;
}

export function SplitButton({
  profile,
  tabs,
  shown,
  inSplit,
  disabled,
  onNewPage,
}: SplitButtonProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const others = tabs.filter((tab) => tab.id !== shown?.id).slice(-OTHER_TABS_SHOWN);

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    setAnchor({ x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: button });
  };

  if (inSplit) {
    return (
      <button
        type="button"
        className="btn bv-hand"
        aria-pressed="true"
        disabled={disabled}
        onClick={() => sendViewCommand(profile, { command: 'split_leave' })}
      >
        <SplitViewIcon />
        Leave split view
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn bv-hand"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={disabled}
        onClick={(event) => (anchor ? setAnchor(null) : open(event))}
      >
        <SplitViewIcon />
        Split view
      </button>
      {anchor && (
        <MenuShell
          anchor={anchor}
          label="Show beside this tab"
          page="main"
          onClose={() => setAnchor(null)}
        >
          <MenuItem
            icon={<PlusIcon />}
            label="New tab"
            onSelect={() => {
              setAnchor(null);
              onNewPage();
              sendViewCommand(profile, { command: 'split_with', tabId: null });
            }}
          />
          {others.map((tab) => (
            <MenuItem
              key={tab.id}
              icon={<SplitViewIcon />}
              label={tabLabel(tab)}
              onSelect={() => {
                setAnchor(null);
                sendViewCommand(profile, { command: 'split_with', tabId: tab.id });
              }}
            />
          ))}
        </MenuShell>
      )}
    </>
  );
}
