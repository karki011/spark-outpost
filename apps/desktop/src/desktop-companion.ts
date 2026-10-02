import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { createCompanion, type Companion, type CompanionStatus } from './companion.ts';
import {
  loadSettings,
  saveSettings,
  SHORTCUT_ACTIONS,
  type CompanionSettings,
  type ShortcutAction,
} from './companion-settings.ts';
import { targetsApi } from './api-token.ts';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { isSize } from './island-geometry.ts';
import { trayTemplate } from './island-options.ts';
import { openIslandWindow, type IslandWindow } from './island-window.ts';

interface CompanionHostOptions {
  appName: string;
  origin: string;
  preload: string;
  settingsPath: string;
  trayIcon: string;
  showSpark: () => void;
  quit: () => void;
}

export interface CompanionHost {
  companion: Companion;
  dispose(): void;
}

const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAG_PHASES: readonly DragPhase[] = ['start', 'move', 'end'];
const SETTINGS_TARGETS = ['island', 'sparks'] as const;
type SettingsTarget = (typeof SETTINGS_TARGETS)[number];

function isSettingsTarget(value: unknown): value is SettingsTarget {
  return SETTINGS_TARGETS.some((target) => target === value);
}

function isShortcutAction(value: unknown): value is ShortcutAction {
  return SHORTCUT_ACTIONS.some((action) => action === value);
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function trayIcon(file: string) {
  const image = nativeImage.createFromPath(file);
  image.setTemplateImage(true);
  return image;
}

export async function startCompanionHost(options: CompanionHostOptions): Promise<CompanionHost> {
  const initial = await loadSettings(options.settingsPath);
  let island: IslandWindow | null = null;
  let pendingChat: string | null = null;
  let pendingSettings: SettingsTarget | null = null;
  let saving = Promise.resolve();
  const tray = new Tray(trayIcon(options.trayIcon));
  tray.setToolTip(options.appName);

  const fromSpark = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    targetsApi(event.senderFrame?.url ?? '', options.origin);
  const fromIsland = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    fromSpark(event) && island !== null && island.owns(event.sender.id);

  const refreshTray = (status: CompanionStatus) => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayTemplate(
          { appName: options.appName, companionOn: status.enabled, supported: status.supported },
          {
            openSpark: options.showSpark,
            toggleCompanion: (on) => companion.setEnabled(on),
            quit: options.quit,
          },
        ),
      ),
    );
  };

  const save = (settings: CompanionSettings) => {
    saving = saving
      .then(() => saveSettings(options.settingsPath, settings))
      .catch((error: Error) => console.error(`[companion] Could not save: ${error.message}`));
  };

  const companion = createCompanion(initial, {
    supported: process.platform === 'darwin',
    openIsland: (onGone) => {
      const opened = openIslandWindow({
        origin: options.origin,
        preload: options.preload,
        position: () => companion.position(),
        savePosition: (position) => companion.setPosition(position),
        onGone: () => {
          if (island === opened) island = null;
          onGone();
        },
      });
      island = opened;
      return opened;
    },
    register: (accelerator, run) => {
      try {
        return globalShortcut.register(accelerator, run);
      } catch {
        return false;
      }
    },
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    save,
    changed: (status) => {
      refreshTray(status);
      broadcast(IPC.companionChanged, status);
    },
  });
  refreshTray(companion.status());

  const sparkFocused = () =>
    BrowserWindow.getAllWindows().some(
      (window) =>
        !window.isDestroyed() && window.isFocused() && !island?.owns(window.webContents.id),
    );
  let focused = sparkFocused();
  const reportFocus = () =>
    setImmediate(() => {
      const next = sparkFocused();
      if (next === focused) return;
      focused = next;
      island?.sparkFocus(next);
    });
  app.on('browser-window-focus', reportFocus);
  app.on('browser-window-blur', reportFocus);
  ipcMain.handle(IPC.islandSparkFocused, (event) => fromIsland(event) && sparkFocused());
  ipcMain.handle(IPC.islandPickFolder, async (event) => {
    if (!fromIsland(event)) return null;
    app.focus({ steal: true });
    const picked = await dialog.showOpenDialog({
      title: 'Choose a project folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.companionGet, (event) => (fromSpark(event) ? companion.status() : null));
  ipcMain.handle(IPC.companionSetEnabled, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setEnabled(on) : companion.status(),
  );
  ipcMain.handle(IPC.companionSetShortcut, (event, action: unknown, accelerator: unknown) => {
    if (!fromSpark(event) || !isShortcutAction(action)) return { ok: false, error: 'Not allowed.' };
    if (accelerator !== null && typeof accelerator !== 'string') {
      return { ok: false, error: 'Not allowed.' };
    }
    return companion.setShortcut(action, accelerator);
  });
  ipcMain.handle(IPC.companionSetSound, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setSound(on) : companion.status(),
  );
  ipcMain.handle(IPC.islandGeometry, (event) => (fromIsland(event) ? island!.geometry() : null));
  ipcMain.handle(IPC.pendingChat, (event) => {
    if (!fromSpark(event) || fromIsland(event)) return null;
    const id = pendingChat;
    pendingChat = null;
    return id;
  });
  ipcMain.handle(IPC.pendingSettings, (event) => {
    if (!fromSpark(event) || fromIsland(event)) return null;
    const pending = pendingSettings;
    pendingSettings = null;
    return pending;
  });
  ipcMain.on(IPC.islandInteractive, (event, on: unknown) => {
    if (fromIsland(event) && typeof on === 'boolean') island!.setInteractive(on);
  });
  ipcMain.on(IPC.islandFocusable, (event, on: unknown) => {
    if (fromIsland(event) && typeof on === 'boolean') island!.setFocusable(on);
  });
  ipcMain.on(IPC.islandDrag, (event, phase: unknown, x: unknown, y: unknown) => {
    if (!fromIsland(event) || !DRAG_PHASES.some((known) => known === phase)) return;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    island!.drag(phase as DragPhase, { x, y });
  });

  ipcMain.on(IPC.islandReady, (event) => {
    if (fromIsland(event)) island!.ready();
  });

  ipcMain.on(IPC.islandRestSize, (event, size: unknown) => {
    if (!fromIsland(event)) return;
    if (size === null) island!.setRestSize(null);
    else if (isSize(size)) island!.setRestSize({ width: size.width, height: size.height });
  });

  const openChat = (id: string) => {
    pendingChat = id;
    options.showSpark();
    broadcast(IPC.openChat, null);
  };

  ipcMain.on(IPC.islandOpenChat, (event, id: unknown) => {
    if (!fromIsland(event)) return;
    if (typeof id === 'string' && CHAT_ID.test(id)) openChat(id);
    else options.showSpark();
  });

  ipcMain.on(IPC.islandOpenSettings, (event, target: unknown) => {
    if (!fromIsland(event) || !isSettingsTarget(target)) return;
    pendingSettings = target;
    options.showSpark();
    broadcast(IPC.openSettings, null);
  });

  return {
    companion,
    dispose: () => {
      companion.shutdown();
      globalShortcut.unregisterAll();
      for (const channel of [
        IPC.companionGet,
        IPC.companionSetEnabled,
        IPC.companionSetShortcut,
        IPC.companionSetSound,
        IPC.islandGeometry,
        IPC.islandSparkFocused,
        IPC.islandPickFolder,
        IPC.pendingChat,
        IPC.pendingSettings,
      ]) {
        ipcMain.removeHandler(channel);
      }
      for (const channel of [
        IPC.islandInteractive,
        IPC.islandFocusable,
        IPC.islandDrag,
        IPC.islandRestSize,
        IPC.islandReady,
        IPC.islandOpenChat,
        IPC.islandOpenSettings,
      ]) {
        ipcMain.removeAllListeners(channel);
      }
      app.off('browser-window-focus', reportFocus);
      app.off('browser-window-blur', reportFocus);
      tray.destroy();
    },
  };
}
