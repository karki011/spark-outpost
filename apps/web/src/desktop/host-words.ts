import { onWindows } from './desktop-bridge.ts';

export interface HostWords {
  computer: string;
  tray: string;
  taskbar: string;
  fileManager: string;
}

const MAC_WORDS: HostWords = {
  computer: 'Mac',
  tray: 'menu bar',
  taskbar: 'Dock',
  fileManager: 'Finder',
};

const WINDOWS_WORDS: HostWords = {
  computer: 'PC',
  tray: 'system tray',
  taskbar: 'taskbar',
  fileManager: 'File Explorer',
};

export function hostWords(windows = onWindows()): HostWords {
  return windows ? WINDOWS_WORDS : MAC_WORDS;
}
