import { useEffect } from 'react';
import { sparkDesktop } from './desktop-bridge.ts';

export function useAppMenu({ sidebarShown }: { sidebarShown: boolean }): void {
  useEffect(() => {
    sparkDesktop()?.menu?.reportSidebar(sidebarShown);
  }, [sidebarShown]);
}
