import { useEffect, useRef } from 'react';
import type { Panel } from './island-model.ts';

const PANEL_KEYS: readonly Panel[] = ['home', 'quick', 'ask'];

interface IslandKeys {
  panel: Panel | null;
  openPanel: (panel: Panel) => void;
  openSpark: () => void;
  escape: () => boolean;
}

export function useIslandKeys(keys: IslandKeys) {
  const latest = useRef(keys);
  useEffect(() => {
    latest.current = keys;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { panel, openPanel, openSpark, escape } = latest.current;
      const command = event.metaKey || event.ctrlKey;
      if (command && panel && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openSpark();
        return;
      }
      const slot = PANEL_KEYS[Number(event.key) - 1];
      if (command && panel && slot) {
        event.preventDefault();
        openPanel(slot);
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escape()) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
