import { ipcMain, WebContentsView, type BrowserWindow, type IpcMainEvent } from 'electron';
import { targetsApi } from './api-token.ts';
import { BOOT_STATUS, leaveDelay, type BootStep } from './boot-steps.ts';
import { IPC } from './ipc-channels.ts';
import { revealGate } from './reveal-gate.ts';
import { guardNavigation, openWindow, type WindowOptions } from './window.ts';

const PAINT_FALLBACK_MS = 1_500;
const RENDER_FALLBACK_MS = 15_000;
const LEAVE_MS = 400;

export interface SparkWindowOptions extends WindowOptions {
  bootPage: string;
  bootPreload: string;
  log: (line: string) => void;
}

export interface SparkWindow {
  window: BrowserWindow;
  status(step: BootStep): void;
  loadApp(origin: string): void;
  focus(): void;
  finished: Promise<void>;
}

function bootView(preload: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor('#00000000');
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event) => event.preventDefault());
  return view;
}

export function openSparkWindow(options: SparkWindowOptions): SparkWindow {
  const window = openWindow(options);
  const boot = bootView(options.bootPreload);
  const contents = boot.webContents;
  const openedAt = Date.now();
  const fit = () => {
    const [width = 0, height = 0] = window.getContentSize();
    boot.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  window.contentView.addChildView(boot);
  window.on('resize', fit);

  let status = BOOT_STATUS.waking;
  let shownAt: number | null = null;
  let origin: string | null = null;
  let leaving = false;
  let renderFallback: ReturnType<typeof setTimeout> | undefined;
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const send = (channel: string, payload?: string) => {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  };
  const reveal = revealGate(() => {
    if (window.isDestroyed()) return;
    shownAt = Date.now();
    window.show();
  }, PAINT_FALLBACK_MS);

  const fromBoot = (event: IpcMainEvent) =>
    !contents.isDestroyed() && event.sender.id === contents.id;
  const fromApp = (event: IpcMainEvent) =>
    origin !== null &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    targetsApi(event.senderFrame?.url ?? '', origin);

  const onPainted = (event: IpcMainEvent) => {
    if (fromBoot(event)) reveal.ready();
  };
  const onRendered = (event: IpcMainEvent) => {
    if (fromApp(event)) leave('the app drew its first content');
  };
  const stopListening = () => {
    clearTimeout(renderFallback);
    ipcMain.off(IPC.bootPainted, onPainted);
    ipcMain.off(IPC.appRendered, onRendered);
  };

  const closeBoot = () => {
    if (!contents.isDestroyed()) contents.close();
    finish();
  };
  const removeBoot = () => {
    if (!window.isDestroyed()) {
      window.off('resize', fit);
      window.contentView.removeChildView(boot);
      window.webContents.focus();
    }
    closeBoot();
  };

  function leave(reason: string) {
    if (leaving) return;
    leaving = true;
    stopListening();
    options.log(`Leaving the boot screen after ${Date.now() - openedAt} ms: ${reason}.`);
    reveal.ready();
    setTimeout(
      () => {
        send(IPC.bootLeave);
        setTimeout(removeBoot, LEAVE_MS);
      },
      leaveDelay(shownAt, Date.now()),
    );
  }

  ipcMain.on(IPC.bootPainted, onPainted);
  ipcMain.on(IPC.appRendered, onRendered);
  contents.on('did-finish-load', () => send(IPC.bootStatus, status));
  window.on('closed', () => {
    reveal.cancel();
    stopListening();
    closeBoot();
  });
  void contents.loadFile(options.bootPage, {
    query: options.theme ? { theme: options.theme } : {},
  });

  const setStatus = (step: BootStep) => {
    status = BOOT_STATUS[step];
    send(IPC.bootStatus, status);
  };

  return {
    window,
    status: setStatus,
    loadApp(appOrigin) {
      if (window.isDestroyed()) return;
      origin = appOrigin;
      setStatus('spark');
      guardNavigation(window, appOrigin);
      renderFallback = setTimeout(
        () => leave('the app did not report its first content in time'),
        RENDER_FALLBACK_MS,
      );
      void window.loadURL(`${appOrigin}/`);
    },
    focus() {
      if (window.isDestroyed() || !reveal.revealed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    finished,
  };
}
