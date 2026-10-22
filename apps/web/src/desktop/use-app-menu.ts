import { useEffect, useRef } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

const TOGGLE_SIDEBAR_COMMAND = 'toggle-sidebar';

interface AppMenuActions {
  sidebarShown: boolean;
  toggleSidebar: () => void;
}

export function useAppMenu({ sidebarShown, toggleSidebar }: AppMenuActions): void {
  const latest = useRef(toggleSidebar);
  useEffect(() => {
    latest.current = toggleSidebar;
  });

  useEffect(
    () =>
      sparkDesktop()?.menu?.onCommand((command) => {
        if (command === TOGGLE_SIDEBAR_COMMAND) latest.current();
      }),
    [],
  );

  useEffect(() => {
    sparkDesktop()?.menu?.reportSidebar(sidebarShown);
  }, [sidebarShown]);
}
