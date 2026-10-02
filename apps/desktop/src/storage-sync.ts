import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { targetsApi } from './api-token.ts';
import { IPC } from './ipc-channels.ts';
import { KEY_PREFIX } from './storage-seed.ts';
import {
  cleanEntries,
  readSnapshot,
  sameEntries,
  seedFor,
  writeSnapshot,
  type StorageSnapshot,
} from './web-storage.ts';

const CAPTURE_EVERY_MS = 15_000;
const CAPTURE_TIMEOUT_MS = 1_000;

const READ_STORAGE = `(() => {
  const entries = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(${JSON.stringify(KEY_PREFIX)})) entries[key] = localStorage.getItem(key);
  }
  return entries;
})()`;

export interface StorageSync {
  capture(): Promise<void>;
  dispose(): void;
}

interface StorageSyncOptions {
  file: string;
  origin: string;
  log: (line: string) => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref()),
  ]);
}

function appWindow(origin: string): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && targetsApi(window.webContents.getURL(), origin),
    ) ?? null
  );
}

export async function startStorageSync(options: StorageSyncOptions): Promise<StorageSync> {
  const { file, origin, log } = options;
  let snapshot: StorageSnapshot | null = await readSnapshot(file);
  let seeded = false;
  let writing = Promise.resolve();

  const onSeed = (event: IpcMainEvent) => {
    if (!targetsApi(event.senderFrame?.url ?? '', origin) || seeded) {
      event.returnValue = null;
      return;
    }
    seeded = true;
    const entries = seedFor(snapshot, origin);
    if (entries) log(`Restored ${Object.keys(entries).length} saved settings for ${origin}.`);
    event.returnValue = entries;
  };
  ipcMain.on(IPC.storageSeed, onSeed);

  const capture = async () => {
    const window = appWindow(origin);
    if (!window) return;
    const raw: unknown = await withTimeout(
      window.webContents.executeJavaScript(READ_STORAGE).catch(() => null),
      CAPTURE_TIMEOUT_MS,
    );
    const entries = cleanEntries(raw);
    if (!entries) return;
    if (snapshot?.origin === origin && sameEntries(snapshot.entries, entries)) return;
    const next = { origin, entries };
    snapshot = next;
    writing = writing
      .then(() => writeSnapshot(file, next))
      .catch((error: Error) => log(`Could not save settings: ${error.message}`));
    await writing;
  };

  const timer = setInterval(() => void capture(), CAPTURE_EVERY_MS);
  timer.unref();

  return {
    capture,
    dispose: () => {
      clearInterval(timer);
      ipcMain.off(IPC.storageSeed, onSeed);
    },
  };
}
