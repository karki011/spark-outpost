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
    const shortcutListeners = new Set<(event: unknown) => void>();
    const foundListeners = new Set<(found: unknown) => void>();
    const viewStateListeners = new Set<(state: unknown) => void>();
    const viewShortcutListeners = new Set<(event: unknown) => void>();
    const viewIntentListeners = new Set<(intent: unknown) => void>();
    const noop = () => () => undefined;
    let signedIn = [
      { origin: 'http://localhost', cookies: 2 },
      { origin: 'https://docs.example.com', cookies: 1 },
    ];
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
    const viewStates = new Map<string, unknown>();
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
      browserShortcut: (event: unknown) => shortcutListeners.forEach((listener) => listener(event)),
      browserFound: (found: unknown) => foundListeners.forEach((listener) => listener(found)),
      browserViewPush: (
        profile: string,
        tabs: Record<string, unknown>[],
        favorites: Record<string, unknown>[] = [],
      ) => {
        const state = {
          profile,
          tabs: tabs.map((item, index) => tab(`v${index + 1}`, item)),
          favorites,
        };
        viewStates.set(profile, state);
        viewStateListeners.forEach((listener) => listener(state));
      },
      browserViewShortcut: (event: unknown) =>
        viewShortcutListeners.forEach((listener) => listener(event)),
      browserViewIntent: (intent: unknown) =>
        viewIntentListeners.forEach((listener) => listener(intent)),
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => null, onChange: noop },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: { get: async () => null, onChange: noop },
        onOpenChat: noop,
        browserView: {
          state: async () => null,
          place: async (placement: unknown) =>
            calls.push({ kind: 'view-place', payload: placement }),
          command: async (profile: string, command: unknown) => {
            calls.push({ kind: 'view-command', payload: { profile, command } });
            return true;
          },
          start: async (profile: string) => {
            calls.push({ kind: 'view-start', payload: profile });
            return viewStates.get(profile) ?? { profile, tabs: [tab('v1', { active: true })] };
          },
          onState: (listener: (state: unknown) => void) => {
            viewStateListeners.add(listener);
            return () => viewStateListeners.delete(listener);
          },
          handToChat: async (request: unknown) => {
            calls.push({ kind: 'view-hand', payload: request });
            return { ok: true };
          },
          pageText: async (profile: string, tabId: string) => {
            calls.push({ kind: 'view-page-text', payload: { profile, tabId } });
            return {
              url: 'https://docs.example.com/deploying',
              title: 'Deploying your app',
              text: 'Promote the preview to production with acme deploy --prod.',
              main: true,
            };
          },
          onIntent: (listener: (intent: unknown) => void) => {
            viewIntentListeners.add(listener);
            return () => viewIntentListeners.delete(listener);
          },
          fromChat: async (request: unknown) => {
            calls.push({ kind: 'view-from-chat', payload: request });
            return { ok: true };
          },
          onSnapshot: noop,
          onShortcut: (listener: (event: unknown) => void) => {
            viewShortcutListeners.add(listener);
            return () => viewShortcutListeners.delete(listener);
          },
          onFound: noop,
        },
        browser: {
          state: async () => null,
          place: async (placement: unknown) => calls.push({ kind: 'place', payload: placement }),
          command: async (chatId: string, command: { command?: string }) => {
            calls.push({ kind: 'command', payload: { chatId, command } });
            if (command.command !== 'close') return true;
            return (window as unknown as { browserClosed?: unknown }).browserClosed ?? true;
          },
          start: async (placement: { chatId: string }) => {
            calls.push({ kind: 'start', payload: placement });
            return { chatId: placement.chatId, tabs: [tab('t1', { active: true })] };
          },
          sites: async () => signedIn,
          signOut: async (origin: string | null) => {
            calls.push({ kind: 'signOut', payload: { origin } });
            signedIn = origin === null ? [] : signedIn.filter((site) => site.origin !== origin);
            return signedIn;
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
          onShortcut: (listener: (event: unknown) => void) => {
            shortcutListeners.add(listener);
            return () => shortcutListeners.delete(listener);
          },
          onFound: (listener: (found: unknown) => void) => {
            foundListeners.add(listener);
            return () => foundListeners.delete(listener);
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
