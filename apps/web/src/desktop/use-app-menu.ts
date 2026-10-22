import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

interface AppMenuActions {
  sidebarShown: boolean;
  toggleSidebar: () => void;
  openSettings: () => void;
}

export function useAppMenu({ sidebarShown, toggleSidebar, openSettings }: AppMenuActions): void {
  const latest = useRef({ toggleSidebar, openSettings });
  useEffect(() => {
    latest.current = { toggleSidebar, openSettings };
  });

  useEffect(() => {
    const menu = sparkDesktop()?.menu;
    if (!menu) return;
    const stopToggle = menu.onToggleSidebar(() => latest.current.toggleSidebar());
    const stopSettings = menu.onOpenSettings(() => latest.current.openSettings());
    return () => {
      stopToggle();
      stopSettings();
    };
  }, []);

  useEffect(() => {
    sparkDesktop()?.menu?.reportSidebar(sidebarShown);
  }, [sidebarShown]);
}
