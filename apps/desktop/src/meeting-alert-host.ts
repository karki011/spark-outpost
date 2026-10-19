import {
  BrowserWindow,
  ipcMain,
  powerMonitor,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  meetingAlertActionSchema,
  meetingAlertPayloadSchema,
  parseIslandRegions,
  type MeetingAlertPayload,
} from '@spark-outpost/contracts';
import { hourCycleArgs } from './hour-cycle-arg.ts';
import { systemHourCycle } from './hour-cycle.ts';
import type { Point } from './island-geometry.ts';
import { ISLAND_LEVEL } from './island-options.ts';
import { IPC } from './ipc-channels.ts';
import { regionPointer, type RegionPointer } from './region-pointer.ts';
import { guardNavigation } from './window.ts';

export const MEETING_ALERT_PATH = '/meeting-alert';

type SparkEvent = IpcMainEvent | IpcMainInvokeEvent;

interface MeetingAlertHostOptions {
  origin: string;
  preload: string;
  trusted: (event: SparkEvent) => boolean;
  fromIsland: (event: SparkEvent) => boolean;
  islandCenter: () => Point | null;
  sendToIsland: (channel: string, payload: unknown) => void;
  hideInShare: () => boolean;
  log: (line: string) => void;
}

export interface MeetingAlertHost {
  setHideInShare(on: boolean): void;
  dispose(): void;
}

function overlayWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    hiddenInMissionControl: true,
    roundedCorners: false,
    type: 'panel',
    title: 'Spark meeting alert',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: hourCycleArgs(systemHourCycle()),
    },
  });
  window.setAlwaysOnTop(true, ISLAND_LEVEL);
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  return window;
}

export function startMeetingAlertHost(options: MeetingAlertHostOptions): MeetingAlertHost {
  let window: BrowserWindow | null = null;
  let pointer: RegionPointer | null = null;
  let shownKey = '';
  let latestPayload: MeetingAlertPayload | null = null;
  let latestPlace: unknown = null;
  let locked = false;
  let asleep = false;

  const fromOverlay = (event: SparkEvent) =>
    options.trusted(event) && window !== null && !window.isDestroyed()
      ? window.webContents.id === event.sender.id
      : false;

  const send = (channel: string, payload: unknown) => {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const ensure = (): BrowserWindow => {
    if (window && !window.isDestroyed()) return window;
    const created = overlayWindow(options.preload);
    created.setContentProtection(options.hideInShare());
    guardNavigation(created, options.origin);
    void created.loadURL(`${options.origin}${MEETING_ALERT_PATH}`);
    pointer = regionPointer(created);
    window = created;
    return created;
  };

  const place = (shown: BrowserWindow) => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    shown.setBounds(display.bounds);
    const island = options.islandCenter();
    const onDisplay =
      island !== null &&
      island.x >= display.bounds.x &&
      island.x < display.bounds.x + display.bounds.width &&
      island.y >= display.bounds.y &&
      island.y < display.bounds.y + display.bounds.height;
    const anchorX = onDisplay ? island.x - display.bounds.x : display.bounds.width / 2;
    latestPlace = {
      anchorX,
      top: Math.max(0, display.workArea.y - display.bounds.y),
      width: display.bounds.width,
      height: display.bounds.height,
    };
    send(IPC.meetingAlertPlace, latestPlace);
  };

  const show = (payload: MeetingAlertPayload) => {
    const shown = ensure();
    const key = JSON.stringify(payload);
    if (key === shownKey && shown.isVisible()) return;
    const fresh = !shown.isVisible();
    shownKey = key;
    latestPayload = payload;
    if (fresh) place(shown);
    send(IPC.meetingAlertPayload, payload);
    if (fresh) {
      shown.showInactive();
      pointer?.start();
      options.log('Meeting alert shown in the centre of the screen.');
    }
  };

  const hide = () => {
    latestPayload = null;
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    shownKey = '';
    send(IPC.meetingAlertLeave, null);
  };

  const gone = () => {
    if (!window || window.isDestroyed()) return;
    pointer?.stop();
    window.setFocusable(false);
    window.hide();
  };

  ipcMain.on(IPC.meetingAlertShow, (event, value: unknown) => {
    if (!options.fromIsland(event)) return;
    const parsed = meetingAlertPayloadSchema.safeParse(value);
    if (parsed.success) show(parsed.data);
  });
  ipcMain.on(IPC.meetingAlertHide, (event) => {
    if (options.fromIsland(event)) hide();
  });
  ipcMain.on(IPC.meetingAlertGone, (event) => {
    if (fromOverlay(event)) gone();
  });
  ipcMain.on(IPC.meetingAlertReady, (event) => {
    if (!fromOverlay(event)) return;
    if (latestPlace) send(IPC.meetingAlertPlace, latestPlace);
    if (latestPayload) send(IPC.meetingAlertPayload, latestPayload);
  });
  ipcMain.on(IPC.meetingAlertAct, (event, value: unknown) => {
    if (!fromOverlay(event)) return;
    const parsed = meetingAlertActionSchema.safeParse(value);
    if (parsed.success) options.sendToIsland(IPC.meetingAlertAction, parsed.data);
  });
  ipcMain.on(IPC.meetingAlertFocus, (event) => {
    if (!fromOverlay(event) || !window) return;
    window.setFocusable(true);
    window.focus();
    window.webContents.focus();
  });
  ipcMain.on(IPC.meetingAlertRegions, (event, value: unknown) => {
    if (!fromOverlay(event)) return;
    const regions = parseIslandRegions(value);
    if (regions) pointer?.setRegions(regions);
  });
  ipcMain.on(IPC.meetingAlertPointerMoved, (event) => {
    if (fromOverlay(event)) pointer?.apply();
  });
  ipcMain.on(IPC.meetingAutoJoined, (event) => {
    if (options.fromIsland(event)) options.log('Joined a meeting automatically.');
  });
  ipcMain.handle(IPC.presenceGet, (event) =>
    options.fromIsland(event)
      ? { idleSeconds: powerMonitor.getSystemIdleTime(), locked, asleep }
      : null,
  );
  const onLock = () => (locked = true);
  const onUnlock = () => (locked = false);
  const onSuspend = () => (asleep = true);
  const onResume = () => (asleep = false);
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('unlock-screen', onUnlock);
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);

  return {
    setHideInShare: (on) => {
      if (window && !window.isDestroyed()) window.setContentProtection(on);
    },
    dispose: () => {
      for (const channel of [
        IPC.meetingAlertShow,
        IPC.meetingAlertHide,
        IPC.meetingAlertGone,
        IPC.meetingAlertReady,
        IPC.meetingAlertAct,
        IPC.meetingAlertFocus,
        IPC.meetingAlertRegions,
        IPC.meetingAlertPointerMoved,
        IPC.meetingAutoJoined,
      ]) {
        ipcMain.removeAllListeners(channel);
      }
      ipcMain.removeHandler(IPC.presenceGet);
      powerMonitor.off('lock-screen', onLock);
      powerMonitor.off('unlock-screen', onUnlock);
      powerMonitor.off('suspend', onSuspend);
      powerMonitor.off('resume', onResume);
      pointer?.stop();
      if (window && !window.isDestroyed()) window.destroy();
    },
  };
}
