import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

const TOGGLE_SIDEBAR_COMMAND = 'toggle-sidebar';

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
    const stopToggle = menu.onCommand((command) => {
      if (command === TOGGLE_SIDEBAR_COMMAND) latest.current.toggleSidebar();
    });
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
