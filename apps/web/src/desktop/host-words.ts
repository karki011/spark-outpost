import { rememberedRemoteHost } from '../app/connection/remote-hint.ts';
import { onWindows } from './desktop-bridge.ts';

export interface HostWords {
  computer: string;
  tray: string;
  taskbar: string;
  fileManager: string;
  app: string;
}

const MAC_WORDS: HostWords = {
  computer: 'Mac',
  tray: 'menu bar',
  taskbar: 'Dock',
  fileManager: 'Finder',
  app: 'Mac app',
};

const WINDOWS_WORDS: HostWords = {
  computer: 'PC',
  tray: 'system tray',
  taskbar: 'taskbar',
  fileManager: 'File Explorer',
  app: 'Windows app',
};

export function hostOnWindows(): boolean {
  const host = rememberedRemoteHost();
  return host === null ? onWindows() : host === 'windows';
}

export function hostWords(windows = hostOnWindows()): HostWords {
  return windows ? WINDOWS_WORDS : MAC_WORDS;
}
