import { useEffect, useSyncExternalStore } from 'react';
import {
  EMPTY_BROWSER_LAYOUT,
  browserProfileSchema,
  browserViewSnapshotSchema,
  browserViewStateSchema,
  type BrowserFavorite,
  type BrowserPaneTab,
  type BrowserProfile,
  type BrowserViewCommand,
  type BrowserViewLayout,
  type BrowserViewSplit,
} from '@spark-outpost/contracts';
import { openOutside } from '../browser/outside-link.ts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

export interface ProfileTabs {
  tabs: readonly BrowserPaneTab[];
  favorites: readonly BrowserFavorite[];
  layout: BrowserViewLayout;
  snapshot: string | null;
  split: BrowserViewSplit | null;
  peek: BrowserPaneTab | null;
  slotImages: Readonly<Record<string, string>>;
}

export type TransferResult = { ok: true } | { ok: false; reason: string };

const EMPTY: ProfileTabs = {
  tabs: [],
  favorites: [],
  layout: EMPTY_BROWSER_LAYOUT,
  snapshot: null,
  split: null,
  peek: null,
  slotImages: {},
};
const viewOpeners = new Set<() => void>();
const PROFILE_KEY = 'spark-outpost.browser-view.profile';

let profiles: ReadonlyMap<BrowserProfile, ProfileTabs> = new Map();
let chosen: BrowserProfile = readProfile();
const listeners = new Set<() => void>();
let connected = false;

function readProfile(): BrowserProfile {
  try {
    const saved = browserProfileSchema.safeParse(localStorage.getItem(PROFILE_KEY));
    return saved.success ? saved.data : 'personal';
  } catch {
    return 'personal';
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function update(profile: BrowserProfile, change: Partial<ProfileTabs>): void {
  const next = new Map(profiles);
  next.set(profile, { ...(profiles.get(profile) ?? EMPTY), ...change });
  profiles = next;
  emit();
}

export function acceptViewState(raw: unknown): void {
  const state = browserViewStateSchema.safeParse(raw);
  if (!state.success) return;
  const { profile, tabs, favorites, layout, split, peek } = state.data;
  update(profile, { tabs, favorites, layout, split, peek });
}

function withSlotImage(profile: BrowserProfile, tabId: string, image: string | null) {
  const images = { ...profiles.get(profile)?.slotImages };
  if (image === null) delete images[tabId];
  else images[tabId] = image;
  return images;
}

function connect(): void {
  const view = desktopBrowserView();
  if (connected || !view) return;
  connected = true;
  view.onState(acceptViewState);
  view.onSnapshot((raw) => {
    const snapshot = browserViewSnapshotSchema.safeParse(raw);
    if (!snapshot.success) return;
    const { profile, image, tabId } = snapshot.data;
    if (tabId === undefined) update(profile, { snapshot: image });
    else update(profile, { slotImages: withSlotImage(profile, tabId, image) });
  });
}

function subscribe(listener: () => void): () => void {
  connect();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function browserViewAvailable(): boolean {
  return desktopBrowserView() !== null;
}

export function useProfileTabs(profile: BrowserProfile): ProfileTabs {
  return useSyncExternalStore(subscribe, () => profiles.get(profile) ?? EMPTY);
}

export function useChosenProfile(): BrowserProfile {
  return useSyncExternalStore(subscribe, () => chosen);
}

export function chooseProfile(profile: BrowserProfile): void {
  if (chosen === profile) return;
  chosen = profile;
  saveProfile(profile);
  emit();
}

function saveProfile(profile: BrowserProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, profile);
  } catch {
    return;
  }
}

export function sendViewCommand(profile: BrowserProfile, command: BrowserViewCommand): void {
  void desktopBrowserView()?.command(profile, command);
}

function transferResult(raw: unknown): TransferResult {
  const result = raw as TransferResult | null;
  if (result?.ok === true) return { ok: true };
  const reason = typeof result?.reason === 'string' ? result.reason : 'That didn’t work.';
  return { ok: false, reason };
}

export async function handTabToChat(
  profile: BrowserProfile,
  tabId: string,
  chatId: string,
): Promise<TransferResult> {
  const view = desktopBrowserView();
  if (!view) return { ok: false, reason: 'The Browser view needs the Mac app.' };
  return transferResult(await view.handToChat({ profile, tabId, chatId }).catch(() => null));
}

export async function openChatTabInView(chatId: string, tabId: string): Promise<TransferResult> {
  const view = desktopBrowserView();
  if (!view) return { ok: false, reason: 'The Browser view needs the Mac app.' };
  const result = transferResult(await view.fromChat({ chatId, tabId }).catch(() => null));
  if (!result.ok) return result;
  chooseProfile('work');
  viewOpeners.forEach((open) => open());
  return result;
}

const VIEW_FULL = 'The Browser view has too many tabs. Close one, then open the link again.';
let linkProblem: string | null = null;

export async function openLinkInView(url: string): Promise<void> {
  const view = desktopBrowserView();
  if (!view) return;
  if (viewOpeners.size === 0) {
    openOutside(url);
    return;
  }
  const opened = await view.openTab(chosen, url).catch(() => false);
  if (opened !== true) {
    linkProblem = VIEW_FULL;
    emit();
  }
  viewOpeners.forEach((open) => open());
}

export function useLinkProblem(): string | null {
  return useSyncExternalStore(subscribe, () => linkProblem);
}

export function clearLinkProblem(): void {
  if (linkProblem === null) return;
  linkProblem = null;
  emit();
}

export function useLinksToView(): void {
  useEffect(() => {
    const view = desktopBrowserView();
    if (!view) return;
    return view.onOpenLink((raw) => {
      if (typeof raw === 'string') void openLinkInView(raw);
    });
  }, []);
}

export function useBrowserViewOpener(open: () => void): void {
  useEffect(() => {
    viewOpeners.add(open);
    return () => {
      viewOpeners.delete(open);
    };
  }, [open]);
}
