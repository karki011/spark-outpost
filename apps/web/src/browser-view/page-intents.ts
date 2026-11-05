import { useEffect, useRef } from 'react';
import {
  browserPickSchema,
  browserViewIntentSchema,
  type BrowserPaneTab,
  type BrowserPick,
  type BrowserProfile,
  type BrowserViewIntent,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { tabLabel } from '../browser/tab-label.ts';
import type { PageRef } from './page-chat.ts';

export function pageRef(profile: BrowserProfile, tab: BrowserPaneTab): PageRef {
  return { profile, tabId: tab.id, title: tabLabel(tab), url: tab.url };
}

export function usePageIntents(
  profile: BrowserProfile,
  tabs: readonly BrowserPaneTab[],
  open: (page: PageRef | null, intent: BrowserViewIntent) => void,
): void {
  const latest = useRef({ tabs, open });
  useEffect(() => {
    latest.current = { tabs, open };
  });
  useEffect(() => {
    const view = desktopBrowserView();
    if (!view) return;
    return view.onIntent((raw) => {
      const intent = browserViewIntentSchema.safeParse(raw);
      if (!intent.success || intent.data.profile !== profile) return;
      const tab = latest.current.tabs.find((candidate) => candidate.id === intent.data.tabId);
      const page = tab && intent.data.link === null ? pageRef(profile, tab) : null;
      latest.current.open(page, intent.data);
    });
  }, [profile]);
}

export function usePagePicks(profile: BrowserProfile, add: (pick: BrowserPick) => void): void {
  const latest = useRef(add);
  useEffect(() => {
    latest.current = add;
  });
  useEffect(() => {
    const view = desktopBrowserView();
    if (!view) return;
    return view.onPicked((raw) => {
      const pick = browserPickSchema.safeParse(raw);
      if (pick.success && pick.data.chatId === profile) latest.current(pick.data);
    });
  }, [profile]);
}
