import { useSyncExternalStore } from 'react';
import {
  browserProfileSchema,
  browserViewSnapshotSchema,
  browserViewStateSchema,
  type BrowserCommand,
  type BrowserPaneTab,
  type BrowserProfile,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

export interface ProfileTabs {
  tabs: readonly BrowserPaneTab[];
  snapshot: string | null;
}

const EMPTY: ProfileTabs = { tabs: [], snapshot: null };
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
  if (state.success) update(state.data.profile, { tabs: state.data.tabs });
}

function connect(): void {
  const view = desktopBrowserView();
  if (connected || !view) return;
  connected = true;
  view.onState(acceptViewState);
  view.onSnapshot((raw) => {
    const snapshot = browserViewSnapshotSchema.safeParse(raw);
    if (snapshot.success) update(snapshot.data.profile, { snapshot: snapshot.data.image });
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

export function sendViewCommand(profile: BrowserProfile, command: BrowserCommand): void {
  void desktopBrowserView()?.command(profile, command);
}
