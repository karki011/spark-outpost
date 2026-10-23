import { useCallback, useEffect, useState } from 'react';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { takeSettingFocus } from './setting-focus.ts';
import { useSettingsRequests } from './settings-request.ts';
import { leaveSettingsRoute, parseSettingsRoute, routeFor } from './settings-route.ts';
import type { SettingsSection } from './settings-sections.tsx';
import { useFollowSettingsWindow } from './settings-sync.ts';

type SetSettings = (next: SettingsSection | null) => void;

function settingsWindow() {
  return sparkDesktop()?.settingsWindow ?? null;
}

export function useSettingsState(): [SettingsSection | null, SetSettings] {
  const [settings, setSettingsState] = useState<SettingsSection | null>(() =>
    settingsWindow() ? null : parseSettingsRoute(window.location.hash),
  );

  const setSettings = useCallback<SetSettings>((next) => {
    const hash = window.location.hash;
    const desktop = settingsWindow();
    if (next !== null && desktop) {
      desktop.open(routeFor(next, hash), takeSettingFocus());
      leaveSettingsRoute();
      return;
    }
    if (next === null || parseSettingsRoute(hash) !== next) leaveSettingsRoute();
    setSettingsState(next);
  }, []);

  useSettingsRequests(setSettings);
  useFollowSettingsWindow();

  useEffect(() => {
    const followRoute = () => {
      const routed = parseSettingsRoute(window.location.hash);
      if (routed) setSettings(routed);
    };
    if (settingsWindow()) followRoute();
    window.addEventListener('hashchange', followRoute);
    return () => window.removeEventListener('hashchange', followRoute);
  }, [setSettings]);

  useEffect(
    () =>
      settingsWindow()?.onDoc((link) => {
        window.location.hash = link;
      }),
    [],
  );

  return [settings, setSettings];
}
