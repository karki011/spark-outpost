import { useId, useState, type ReactNode } from 'react';
import { PageTabs } from '../ui/PageTabs.tsx';
import { REMOTE_TABS, afterSetupChange, remoteTab, type RemoteTab } from './remote-tabs.ts';

interface RemoteTabsProps {
  setup: boolean;
  panels: Record<RemoteTab, ReactNode>;
}

export function RemoteTabs({ setup, panels }: RemoteTabsProps) {
  const base = useId();
  const [chosen, setChosen] = useState<RemoteTab | null>(null);
  const [seenSetup, setSeenSetup] = useState(setup);
  if (seenSetup !== setup) {
    setSeenSetup(setup);
    setChosen(afterSetupChange(chosen));
  }
  const tab = remoteTab(chosen, setup);
  return (
    <div className="ph-tabbed">
      <PageTabs
        ariaLabel="Remote control"
        idBase={base}
        options={REMOTE_TABS}
        value={tab}
        onChange={(id) => setChosen(id as RemoteTab)}
      />
      {REMOTE_TABS.map(({ id }) => (
        <div
          key={id}
          id={`${base}-panel-${id}`}
          className="ph-tab-panel"
          role="tabpanel"
          aria-labelledby={`${base}-tab-${id}`}
          hidden={tab !== id}
        >
          {panels[id]}
        </div>
      ))}
    </div>
  );
}
