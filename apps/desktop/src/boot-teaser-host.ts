import { ipcMain } from 'electron';
import changelog from '../CHANGELOG.md';
import { teaserLines } from './boot-teasers.ts';
import { DEFAULT_SHORTCUTS, loadSettings, settingsFile } from './companion-settings.ts';
import { IPC } from './ipc-channels.ts';
import {
  readTeaserSnapshot,
  startTeaserSnapshots,
  teaserFile,
  type TeaserSnapshots,
} from './teaser-snapshot.ts';

export interface BootTeasersOptions {
  userData: string;
  version: string;
  log: (line: string) => void;
}

export function startBootTeasers(options: BootTeasersOptions) {
  const file = teaserFile(options.userData);
  const teasers = Promise.all([
    readTeaserSnapshot(file),
    loadSettings(settingsFile(options.userData)),
  ]).then(([snapshot, settings]) =>
    teaserLines({
      snapshot,
      changelog,
      version: options.version,
      defaultShortcut: settings.shortcuts.quick === DEFAULT_SHORTCUTS.quick,
      now: new Date(),
      random: Math.random,
    }),
  );
  ipcMain.handle(IPC.bootTeasers, () => teasers.catch(() => []));
  let snapshots: TeaserSnapshots | null = null;
  return {
    watch(origin: string, token: string) {
      snapshots = startTeaserSnapshots({ origin, token }, file, options.log);
    },
    saveNow: () => snapshots?.saveNow() ?? Promise.resolve(),
  };
}
