import type { BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { PickElementIcon, PickRegionIcon } from '../browser/BrowserIcons.tsx';
import { ToolButton } from '../browser/ToolButton.tsx';
import { sendViewCommand } from './view-store.ts';

interface ViewSelectProps {
  profile: BrowserProfile;
  tab: BrowserPaneTab | null;
  disabled: boolean;
}

export function ViewSelect({ profile, tab, disabled }: ViewSelectProps) {
  const picking = tab?.picking ?? false;
  const pick = (mode: 'element' | 'region') => {
    if (!tab) return;
    sendViewCommand(profile, {
      command: 'pick',
      tabId: tab.id,
      mode: picking ? 'off' : mode,
    });
  };
  return (
    <>
      <ToolButton
        label={picking ? 'Stop selecting' : 'Select an element for a new chat'}
        disabled={disabled}
        pressed={picking}
        onClick={() => pick('element')}
      >
        <PickElementIcon />
      </ToolButton>
      <ToolButton
        label="Select a region for a new chat"
        disabled={disabled || picking}
        onClick={() => pick('region')}
      >
        <PickRegionIcon />
      </ToolButton>
    </>
  );
}
