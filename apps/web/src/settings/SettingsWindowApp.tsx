import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { FEEDBACK_SETTINGS_FOCUS } from '@spark-outpost/contracts';
import { useAppEvents } from '../app/live/use-app-events.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { requestFeedback } from '../help/feedback-request.ts';
import { ResetHost } from '../reset/ResetHost.tsx';
import { TeammateHost } from '../teammates/TeammateHost.tsx';
import { DocsReachable } from '../ui/DocLink.tsx';
import { requestSettingFocus } from './setting-focus.ts';
import { useSettingsRequests } from './settings-request.ts';
import { parseSettingsRoute, routeFor } from './settings-route.ts';
import type { SettingsSection } from './settings-sections.tsx';
import { useAnnounceSettingChanges } from './settings-sync.ts';
import { SettingsPanes, sectionLabel } from './SettingsPanes.tsx';
import './settings-window.css';

const DOC_LINK = 'a[href^="#/docs"]';

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentHash(): string {
  return window.location.hash;
}

function goTo(route: string): void {
  if (window.location.hash !== route) window.location.hash = route;
}

function useSettingsTargets(): void {
  useEffect(() => {
    const desktop = sparkDesktop()?.settingsWindow;
    if (!desktop) return;
    const take = () =>
      void desktop.take().then((target) => {
        if (!target) return;
        goTo(target.route);
        if (target.focus === FEEDBACK_SETTINGS_FOCUS) requestFeedback();
        else if (target.focus) requestSettingFocus(target.focus);
      });
    take();
    return desktop.onChange(take);
  }, []);
}

function useDocLinksInMainWindow(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest(DOC_LINK) : null;
      const href = link?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      sparkDesktop()?.settingsWindow?.openDoc(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export function SettingsWindowApp() {
  const hash = useSyncExternalStore(subscribeHash, currentHash);
  const section = parseSettingsRoute(hash) ?? 'spark';
  useAppEvents();
  useAnnounceSettingChanges();
  useSettingsTargets();
  useDocLinksInMainWindow();

  useLayoutEffect(() => {
    document.title = sectionLabel(section);
  }, [section]);

  const open = useCallback((next: SettingsSection) => goTo(routeFor(next, currentHash())), []);
  useSettingsRequests(open);

  return (
    <DocsReachable value>
      <main className="set-window" aria-labelledby="set-title">
        <SettingsPanes
          section={section}
          onSection={open}
          onOpenChat={(id) => sparkDesktop()?.settingsWindow?.openChat(id)}
        />
      </main>
      <TeammateHost />
      <ResetHost />
    </DocsReachable>
  );
}
