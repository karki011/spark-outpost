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
  type NativeImage,
  type IpcMainInvokeEvent,
} from 'electron';
import { isIslandHeight, parseIslandRegions } from '@spark-outpost/contracts';
import {
  createCompanion,
  SHORTCUT_NAMES,
  type Companion,
  type CompanionStatus,
} from './companion.ts';
import {
  isIslandSize,
  loadSettings,
  saveSettings,
  SHORTCUT_ACTIONS,
  type CompanionSettings,
  type ShortcutAction,
} from './companion-settings.ts';
import { targetsApi } from './api-token.ts';
import { appLockGate } from './app-lock-gate.ts';
import { heldNavigation } from './held-navigation.ts';
import { startAttentionHost, type AttentionHost } from './attention-host.ts';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { isSize } from './island-geometry.ts';
import { dockTemplate, trayTemplate } from './island-options.ts';
import { islandSupported } from './island-platform.ts';
import { openIslandWindow, type IslandWindow } from './island-window.ts';
import { jumpTaskIn, type JumpTask } from './deep-link.ts';
import { jumpListTasks, type JumpLaunch } from './jump-list.ts';
import { appLayout } from './layout.ts';
import { menuBarItem, type MenuBarTray } from './menu-bar.ts';
import { noActivate } from './no-activate.ts';
import { readAssistiveTech } from './assistive-tech.ts';
import { startMeetingAlertHost } from './meeting-alert-host.ts';
import { electronNotices, meetingNotifier } from './meeting-notification.ts';
import { watchSparkFocus } from './spark-focus.ts';
import { startViewingHost } from './viewing-host.ts';
import { watchHourCycle } from './hour-cycle.ts';
import { startVoiceHost, type VoiceHost } from './voice/host.ts';
import { meetingHub } from './voice/meeting-hub.ts';

interface CompanionHostOptions {
  appName: string;
  channelBadge: string | null;
  origin: string;
  apiToken: string;
  preload: string;
  settingsPath: string;
  trayIcon: string;
  badgeWindow: () => BrowserWindow | null;
  showSpark: () => void;
  quit: () => void;
  log: (line: string) => void;
}

export interface CompanionHost {
  companion: Companion;
  openChat(id: string): void;
  runJumpTask(task: JumpTask): void;
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

const WINDOWS_TRAY_SIZE = 32;

function jumpLaunch(): JumpLaunch {
  return {
    program: process.execPath,
    leadingArgs: app.isPackaged ? [] : [app.getAppPath()],
  };
}

function trayImage(iconFile: string): NativeImage {
  const image = nativeImage.createFromPath(iconFile);
  if (process.platform === 'win32') {
    return image.resize({ width: WINDOWS_TRAY_SIZE, height: WINDOWS_TRAY_SIZE, quality: 'best' });
  }
  image.setTemplateImage(true);
  return image;
}

function openTray(iconFile: string, toolTip: string): MenuBarTray {
  const image = trayImage(iconFile);
  const tray = new Tray(image);
  tray.setToolTip(toolTip);
  return {
    setMenu: (template) => tray.setContextMenu(Menu.buildFromTemplate(template)),
    destroy: () => tray.destroy(),
  };
}

export async function startCompanionHost(options: CompanionHostOptions): Promise<CompanionHost> {
  const initial = await loadSettings(options.settingsPath);
  let island: IslandWindow | null = null;
  const navigation = heldNavigation({
    locked: appLockGate.locked,
    announce: (kind) => broadcast(kind === 'chat' ? IPC.openChat : IPC.openSettings, null),
  });
  const stopLockWatch = appLockGate.onLockedChange((locked) => {
    if (!locked) navigation.unlocked();
  });
  let attention: AttentionHost | null = null;
  const menuBar = menuBarItem(() => openTray(options.trayIcon, options.appName));

  const fromSpark = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    targetsApi(event.senderFrame?.url ?? '', options.origin);
  const fromIsland = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    fromSpark(event) && island !== null && island.owns(event.sender.id);

  const refreshMenus = (status: CompanionStatus) => {
    const state = {
      appName: options.appName,
      companionOn: status.enabled,
      supported: status.supported,
      lockAvailable: appLockGate.available(),
    };
    const actions = {
      openSpark: options.showSpark,
      toggleCompanion: (on: boolean) => void companion.setEnabled(on),
      lock: appLockGate.lockNow,
      quit: options.quit,
    };
    menuBar.update(status.menuBar, trayTemplate(state, actions));
    app.dock?.setMenu(Menu.buildFromTemplate(dockTemplate(state, actions)));
    if (process.platform === 'win32') app.setUserTasks(jumpListTasks(state, jumpLaunch()));
  };

  const save = async (settings: CompanionSettings) => {
    try {
      await saveSettings(options.settingsPath, settings);
    } catch (error) {
      console.error(
        `[companion] Could not save: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  };

  const layout = appLayout({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const preventActivation =
    process.platform === 'win32'
      ? () => undefined
      : noActivate(layout.noActivateAddon, options.log);

  const registerShortcut = (accelerator: string, run: () => void) => {
    try {
      return globalShortcut.register(accelerator, run);
    } catch {
      return false;
    }
  };

  const companion = createCompanion(initial, {
    supported: islandSupported(process.platform),
    openIsland: (onGone) => {
      const opened = openIslandWindow({
        origin: options.origin,
        preload: options.preload,
        position: () => companion.position(),
        size: () => companion.status().islandSize,
        hideInShare: () => companion.status().hideInShare,
        savePosition: (position) => companion.setPosition(position),
        preventActivation,
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
    register: registerShortcut,
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    save,
    preview: (status) => broadcast(IPC.companionChanged, status),
    changed: (status) => {
      refreshMenus(status);
      attention?.refresh();
      broadcast(IPC.companionChanged, status);
    },
  });
  refreshMenus(companion.status());
  let lockOffered = appLockGate.available();
  const stopLockMenuWatch = appLockGate.onChange(() => {
    if (lockOffered === appLockGate.available()) return;
    lockOffered = appLockGate.available();
    refreshMenus(companion.status());
  });

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
  const stopFocusWatch = watchSparkFocus(app, BrowserWindow.getAllWindows(), reportFocus);
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
  ipcMain.handle(IPC.companionSetIslandHeight, (event, height: unknown) => {
    if (!fromSpark(event) || !isIslandHeight(height)) return companion.status();
    return companion.setIslandHeight(height);
  });
  ipcMain.handle(IPC.companionPreviewIslandHeight, (event, height: unknown) =>
    fromSpark(event) && isIslandHeight(height)
      ? companion.previewIslandHeight(height)
      : companion.status(),
  );
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
  ipcMain.handle(IPC.companionSetMenuBar, (event, on: unknown) =>
    fromSpark(event) && typeof on === 'boolean' ? companion.setMenuBar(on) : companion.status(),
  );
  ipcMain.handle(IPC.islandGeometry, (event) => (fromIsland(event) ? island!.geometry() : null));
  ipcMain.handle(IPC.pendingChat, (event) => {
    return fromSpark(event) && !fromIsland(event) ? navigation.takeChat() : null;
  });
  ipcMain.handle(IPC.pendingSettings, (event) => {
    return fromSpark(event) && !fromIsland(event) ? navigation.takeSettings() : null;
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
    options.showSpark();
    navigation.openChat({ id, runId });
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
    badgeWindow: options.badgeWindow,
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
    preventActivation,
    assistive: readAssistiveTech,
    register: registerShortcut,
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    notifier: meetingNotifier(electronNotices(options.log)),
    log: options.log,
  });

  const voice: VoiceHost | null = await startVoiceHost({
    helperPath: layout.voiceBin,
    modelsDir: layout.voiceModels,
    userData: path.dirname(options.settingsPath),
    trusted: fromSpark,
    windows: () =>
      BrowserWindow.getAllWindows()
        .filter(
          (window) =>
            !window.isDestroyed() && targetsApi(window.webContents.getURL(), options.origin),
        )
        .map((window) => ({
          id: window.webContents.id,
          island: island?.owns(window.webContents.id) ?? false,
          focused: window.isFocused(),
          onScreen: window.isVisible() && !window.isMinimized(),
        })),
    appActive: () => (process.platform === 'darwin' ? app.isActive() : false),
    island: () =>
      BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && island?.owns(window.webContents.id),
      )?.webContents ?? null,
    takenBy: (accelerator) => {
      const { shortcuts } = companion.status();
      const action = SHORTCUT_ACTIONS.find((each) => shortcuts[each] === accelerator);
      return action ? SHORTCUT_NAMES[action] : null;
    },
    log: options.log,
  });
  if (voice) meetingHub.attach(voice.meetings);

  ipcMain.on(IPC.islandOpenChat, (event, id: unknown, runId: unknown) => {
    if (!fromIsland(event)) return;
    const turn = typeof runId === 'string' && CHAT_ID.test(runId) ? runId : null;
    if (typeof id === 'string' && CHAT_ID.test(id)) openChat(id, turn);
    else options.showSpark();
  });

  ipcMain.on(IPC.islandOpenSettings, (event, target: unknown) => {
    if (!fromIsland(event) || !isSettingsTarget(target)) return;
    options.showSpark();
    navigation.openSettings(target);
  });

  const runJumpTask = (task: JumpTask) => {
    if (task === 'lock') appLockGate.lockNow();
    else void companion.setEnabled(task === 'show-island');
  };
  const launchTask = jumpTaskIn(process.argv);
  if (launchTask) runJumpTask(launchTask);

  return {
    companion,
    openChat,
    runJumpTask,
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
        IPC.companionSetIslandHeight,
        IPC.companionPreviewIslandHeight,
        IPC.companionSetAutoExpand,
        IPC.companionSetHideInShare,
        IPC.companionSetNotify,
        IPC.companionSetMenuBar,
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
      stopFocusWatch();
      stopLockWatch();
      stopLockMenuWatch();
      menuBar.dispose();
    },
  };
}
