import { useState } from 'react';
import type { ConnectableId } from '@spark-outpost/contracts';
import type { TileStatus } from './tile-status.ts';

export type SectionId = 'connect' | 'test' | 'defaults' | 'danger';

export type ScreenState = 'setup' | 'ok' | 'failing';

const STORAGE_KEY = 'spark-outpost.provider-sections';

export function screenState(connected: boolean, status: TileStatus): ScreenState {
  if (!connected) return 'setup';
  return status.tone === 'ok' ? 'ok' : 'failing';
}

export function openByDefault(section: SectionId, state: ScreenState, status: TileStatus): boolean {
  if (state === 'setup') return section === 'connect';
  if (state === 'ok') return false;
  return section === (status.label === 'Needs sign-in' ? 'connect' : 'test');
}

type Remembered = Record<string, boolean>;

function readRemembered(): Remembered {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Remembered) : {};
  } catch {
    return {};
  }
}

function remember(key: string, open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readRemembered(), [key]: open }));
  } catch {
    return;
  }
}

export function useSectionState(providerId: ConnectableId, state: ScreenState, status: TileStatus) {
  const [remembered, setRemembered] = useState(readRemembered);
  const keyFor = (section: SectionId) => `${providerId}:${state}:${section}`;
  const isOpen = (section: SectionId) =>
    remembered[keyFor(section)] ?? openByDefault(section, state, status);
  const setOpen = (section: SectionId, open: boolean) => {
    remember(keyFor(section), open);
    setRemembered((current) => ({ ...current, [keyFor(section)]: open }));
  };
  return { isOpen, setOpen };
}
