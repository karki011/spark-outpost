import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

interface AppMenuActions {
  sidebarShown: boolean;
  toggleSidebar: () => void;
}

export function useAppMenu({ sidebarShown, toggleSidebar }: AppMenuActions): void {
  const latest = useRef(toggleSidebar);
  useEffect(() => {
    latest.current = toggleSidebar;
  });

  useEffect(() => sparkDesktop()?.menu?.onToggleSidebar(() => latest.current()), []);

  useEffect(() => {
    sparkDesktop()?.menu?.reportSidebar(sidebarShown);
  }, [sidebarShown]);
}
