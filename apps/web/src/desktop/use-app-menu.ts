import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

interface AppMenuActions {
  sidebarShown: boolean;
  openSettings: () => void;
}

export function useAppMenu({ sidebarShown, openSettings }: AppMenuActions): void {
  const latest = useRef(openSettings);
  useEffect(() => {
    latest.current = openSettings;
  });

  useEffect(() => sparkDesktop()?.menu?.onOpenSettings(() => latest.current()), []);

  useEffect(() => {
    sparkDesktop()?.menu?.reportSidebar(sidebarShown);
  }, [sidebarShown]);
}
