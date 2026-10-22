import path from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { parseIslandRegions } from '@spark-outpost/contracts';
import { createCompanion, type Companion, type CompanionStatus } from './companion.ts';
import {
  isIslandSize,
  loadSettings,
  saveSettings,
  SHORTCUT_ACTIONS,
  type CompanionSettings,
  type ShortcutAction,
} from './companion-settings.ts';
import { targetsApi } from './api-token.ts';
import { startAttentionHost, type AttentionHost } from './attention-host.ts';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { isSize } from './island-geometry.ts';
import { trayTemplate } from './island-options.ts';
import { openIslandWindow, type IslandWindow } from './island-window.ts';
import { appLayout } from './layout.ts';
import { startMeetingAlertHost } from './meeting-alert-host.ts';
import { startViewingHost } from './viewing-host.ts';
import { watchHourCycle } from './hour-cycle.ts';
import { startVoiceHost, type VoiceHost } from './voice/host.ts';

interface CompanionHostOptions {
  appName: string;
  channelBadge: string | null;
  origin: string;
  apiToken: string;
  preload: string;
  settingsPath: string;
  trayIcon: string;
  showSpark: () => void;
  quit: () => void;
  log: (line: string) => void;
}

export interface CompanionHost {
  companion: Companion;
  openChat(id: string): void;
  dispose(): void;
}

const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAG_PHASES: readonly DragPhase[] = ['start', 'lift', 'move', 'end'];
const SETTINGS_TARGETS: readonly string[] = ['island', 'sparks', 'spark-new', 'connectors'];
const SPARK_EDIT_TARGET =
  /^spark-edit:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TODAY_TARGET = /^today:\P{Cc}{1,600}$/u;

function isSettingsTarget(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (SETTINGS_TARGETS.includes(value) || SPARK_EDIT_TARGET.test(value) || TODAY_TARGET.test(value))
  );
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
  let pendingChat: { id: string; runId: string | null } | null = null;
  let pendingSettings: string | null = null;
  let saving = Promise.resolve();
  let attention: AttentionHost | null = null;
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
        size: () => companion.status().islandSize,
        hideInShare: () => companion.status().hideInShare,
        savePosition: (position) => companion.setPosition(position),
        log: options.log,
        onGone: () => {
          if (island === opened) island = null;
          onGone();
        },
      });
      island = opened;
      opened.sparkFocus(sparkFocused());
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
      attention?.refresh();
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
  app.on('did-become-active', reportFocus);
  ipcMain.handle(IPC.islandSparkFocused, (event) => fromIsland(event) && sparkFocused());

  ipcMain.handle(IPC.companionGet, (event) => (fromSpark(event) ? companion.status() : null));
  ipcMain.handle(IPC.companionSetEnabled, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setEnabled(on) : companion.status(),
  );
  ipcMain.handle(IPC.companionSetShortcut, (event, action: unknown, accelerator: unknown) => {
    if (!fromSpark(event) || !isShortcutAction(action)) return { ok: false, error: 'Not allowed.' };
    if (accelerator !== null && typeof accelerator !== 'string') {
      return { ok: false, error: 'Not allowed.' };
    }
    if (accelerator !== null && accelerator === voice?.shortcut()) {
      return { ok: false, error: 'This shortcut already starts Voice.' };
    }
    return companion.setShortcut(action, accelerator);
  });
  ipcMain.handle(IPC.companionSetSound, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setSound(on) : companion.status(),
  );
  ipcMain.handle(IPC.companionSetIslandSize, (event, size: unknown) => {
    if (!fromSpark(event) || !isIslandSize(size)) return companion.status();
    const status = companion.setIslandSize(size);
    island?.sizeChanged();
    return status;
  });
  ipcMain.handle(IPC.companionSetAutoExpand, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setAutoExpand(on) : companion.status(),
  );
  ipcMain.handle(IPC.companionSetHideInShare, (event, on: unknown) => {
    if (!fromSpark(event) || typeof on !== 'boolean') return companion.status();
    const status = companion.setHideInShare(on);
    island?.setHideInShare(on);
    meetingAlert.setHideInShare(on);
    return status;
  });
  ipcMain.handle(IPC.companionSetNotify, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setNotify(on) : companion.status(),
  );
  ipcMain.handle(IPC.islandGeometry, (event) => (fromIsland(event) ? island!.geometry() : null));
  ipcMain.handle(IPC.pendingChat, (event) => {
    if (!fromSpark(event) || fromIsland(event)) return null;
    const pending = pendingChat;
    pendingChat = null;
    return pending;
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
  ipcMain.on(IPC.islandRegions, (event, value: unknown) => {
    if (!fromIsland(event)) return;
    const regions = parseIslandRegions(value);
    if (regions) island!.setRegions(regions);
  });
  ipcMain.on(IPC.islandPointerMoved, (event) => {
    if (fromIsland(event)) island!.pointerMoved();
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

  const openChat = (id: string, runId: string | null = null) => {
    pendingChat = { id, runId };
    options.showSpark();
    broadcast(IPC.openChat, null);
  };

  attention = startAttentionHost({
    channelBadge: options.channelBadge,
    origin: options.origin,
    token: options.apiToken,
    trusted: fromSpark,
    enabled: () => companion.status().notify,
    islandShowing: () => companion.running(),
    sparkFocused,
    openChat,
    showSpark: options.showSpark,
    blocked: (on) => companion.setNotifyBlocked(on),
    log: options.log,
  });

  const stopHourCycle = watchHourCycle();
  const viewing = startViewingHost({
    trusted: fromSpark,
    fromIsland,
    onChange: (viewed) => attention?.viewing(viewed),
  });

  const meetingAlert = startMeetingAlertHost({
    origin: options.origin,
    preload: options.preload,
    trusted: fromSpark,
    fromIsland,
    islandCenter: () => island?.center() ?? null,
    sendToIsland: (channel, payload) => island?.post(channel, payload),
    hideInShare: () => companion.status().hideInShare,
    log: options.log,
  });

  const layout = appLayout({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const voice: VoiceHost | null = await startVoiceHost({
    helperPath: layout.voiceBin,
    modelsDir: layout.voiceModels,
    userData: path.dirname(options.settingsPath),
    trusted: fromSpark,
    island: () =>
      BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && island?.owns(window.webContents.id),
      )?.webContents ?? null,
    log: options.log,
  });

  ipcMain.on(IPC.islandOpenChat, (event, id: unknown, runId: unknown) => {
    if (!fromIsland(event)) return;
    const turn = typeof runId === 'string' && CHAT_ID.test(runId) ? runId : null;
    if (typeof id === 'string' && CHAT_ID.test(id)) openChat(id, turn);
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
    openChat,
    dispose: () => {
      attention?.dispose();
      viewing.dispose();
      stopHourCycle();
      meetingAlert.dispose();
      voice?.dispose();
      companion.shutdown();
      globalShortcut.unregisterAll();
      for (const channel of [
        IPC.companionGet,
        IPC.companionSetEnabled,
        IPC.companionSetShortcut,
        IPC.companionSetSound,
        IPC.companionSetIslandSize,
        IPC.companionSetAutoExpand,
        IPC.companionSetHideInShare,
        IPC.companionSetNotify,
        IPC.islandGeometry,
        IPC.islandSparkFocused,
        IPC.pendingChat,
        IPC.pendingSettings,
      ]) {
        ipcMain.removeHandler(channel);
      }
      for (const channel of [
        IPC.islandInteractive,
        IPC.islandRegions,
        IPC.islandPointerMoved,
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
      app.off('did-become-active', reportFocus);
      tray.destroy();
    },
  };
}
