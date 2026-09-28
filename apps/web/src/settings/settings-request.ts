import { useEffect } from 'react';
import type { SettingsSection } from './SettingsDialog.tsx';

const listeners = new Set<(section: SettingsSection) => void>();

export function requestSettings(section: SettingsSection): void {
  for (const listener of listeners) listener(section);
}

export function useSettingsRequests(open: (section: SettingsSection) => void): void {
  useEffect(() => {
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [open]);
}
