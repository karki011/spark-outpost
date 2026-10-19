import type { Page } from '@playwright/test';

interface PaneCall {
  kind: string;
  payload: unknown;
}

export async function withDesktopBrowser(page: Page) {
  await page.addInitScript(() => {
    const calls: { kind: string; payload: unknown }[] = [];
    const stateListeners = new Set<(state: unknown) => void>();
    const snapshotListeners = new Set<(snapshot: unknown) => void>();
    const pickListeners = new Set<(pick: unknown) => void>();
    const textListeners = new Set<(selected: unknown) => void>();
    const noop = () => () => undefined;
    const tab = (id: string, change: Record<string, unknown>) => ({
      id,
      title: '',
      url: '',
      owner: 'user',
      active: false,
      place: 'local',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      pinned: false,
      kept: false,
      handoff: null,
      driving: false,
      picking: false,
      lastAction: null,
      error: null,
      ...change,
    });
    Object.assign(window, {
      browserCalls: calls,
      browserPush: (chatId: string, tabs: Record<string, unknown>[]) => {
        const state = { chatId, tabs: tabs.map((item, index) => tab(`t${index + 1}`, item)) };
        stateListeners.forEach((listener) => listener(state));
      },
      browserSnapshot: (chatId: string, image: string | null) =>
        snapshotListeners.forEach((listener) => listener({ chatId, image })),
      browserPick: (pick: unknown) => pickListeners.forEach((listener) => listener(pick)),
      browserSelectedText: (selected: unknown) =>
        textListeners.forEach((listener) => listener(selected)),
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: noop },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: { get: async () => null, onChange: noop },
        onOpenChat: noop,
        browser: {
          state: async () => null,
          place: async (placement: unknown) => calls.push({ kind: 'place', payload: placement }),
          command: async (chatId: string, command: unknown) =>
            calls.push({ kind: 'command', payload: { chatId, command } }),
          start: async (placement: { chatId: string }) => {
            calls.push({ kind: 'start', payload: placement });
            return { chatId: placement.chatId, tabs: [tab('t1', { active: true })] };
          },
          sites: async () => [{ origin: 'http://localhost', cookies: 2 }],
          signOut: async (projectId: string, origin: string | null) => {
            calls.push({ kind: 'signOut', payload: { projectId, origin } });
            return [];
          },
          onState: (listener: (state: unknown) => void) => {
            stateListeners.add(listener);
            return () => stateListeners.delete(listener);
          },
          onSnapshot: (listener: (snapshot: unknown) => void) => {
            snapshotListeners.add(listener);
            return () => snapshotListeners.delete(listener);
          },
          onPicked: (listener: (pick: unknown) => void) => {
            pickListeners.add(listener);
            return () => pickListeners.delete(listener);
          },
          onSelectedText: (listener: (selected: unknown) => void) => {
            textListeners.add(listener);
            return () => textListeners.delete(listener);
          },
        },
      },
    });
  });
}

export const calls = (page: Page, kind: string) =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { browserCalls: PaneCall[] }).browserCalls
        .filter((call) => call.kind === wanted)
        .map((call) => call.payload),
    kind,
  );
