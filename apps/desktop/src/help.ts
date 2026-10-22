import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  API_TOKEN_HEADER,
  DIAGNOSTICS_EXPORT_PATH,
  diagnosticsFileName,
  isBetaVersion,
  type DesktopHelpInfo,
  type DiagnosticsExport,
} from '@spark-outpost/contracts';
import { appMenuTemplate, type HelpActions } from './help-menu.ts';
import { IPC } from './ipc-channels.ts';

const EXPORT_TIMEOUT_MS = 60_000;
const TOGGLE_SIDEBAR_COMMAND = 'toggle-sidebar';

export interface HelpOptions {
  version: string;
  logsFolder: string;
  apiUrl: string;
  token: string;
  trusted: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean;
  showSpark: () => void;
  mainWindow: () => BrowserWindow | null;
  paneShortcut: HelpActions['paneShortcut'];
  log: (line: string) => void;
}

export interface Help {
  dispose(): void;
}

async function diagnosticsZip(apiUrl: string, token: string): Promise<Buffer> {
  const response = await fetch(`${apiUrl}${DIAGNOSTICS_EXPORT_PATH}`, {
    headers: { [API_TOKEN_HEADER]: token },
    signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Spark couldn't collect diagnostics (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

async function saveDiagnostics(options: HelpOptions): Promise<DiagnosticsExport> {
  const zip = await diagnosticsZip(options.apiUrl, options.token);
  const dialogOptions = {
    title: 'Export diagnostics',
    buttonLabel: 'Save',
    defaultPath: path.join(app.getPath('downloads'), diagnosticsFileName(new Date())),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  };
  const parent = focusedWindow();
  const { canceled, filePath } = parent
    ? await dialog.showSaveDialog(parent, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { saved: false };
  await writeFile(filePath, zip, { mode: 0o600 });
  options.log(`Saved diagnostics to ${filePath}.`);
  return { saved: true, path: filePath };
}

async function showLogs(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await shell.openPath(folder);
}

async function exportFromMenu(options: HelpOptions): Promise<void> {
  try {
    const result = await saveDiagnostics(options);
    if (result.saved) shell.showItemInFolder(result.path);
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      message: "Spark couldn't export diagnostics",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const CHANNELS = [
  IPC.helpInfo,
  IPC.helpExportDiagnostics,
  IPC.helpShowLogs,
  IPC.helpPending,
  IPC.menuSettingsPending,
];

export function startHelp(options: HelpOptions): Help {
  const info: DesktopHelpInfo = {
    version: options.version,
    beta: isBetaVersion(options.version),
    logsFolder: options.logsFolder,
  };
  let feedbackPending = false;
  let settingsPending = false;
  const toMainWindow = (channel: string, payload?: string) => {
    const window = options.mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const sendFeedback = () => {
    feedbackPending = true;
    options.showSpark();
    toMainWindow(IPC.helpOpen);
  };
  const handle = (channel: string, handler: () => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, (event) => (options.trusted(event) ? handler() : null));
  };
  handle(IPC.helpInfo, () => info);
  handle(IPC.helpExportDiagnostics, () => saveDiagnostics(options));
  handle(IPC.helpShowLogs, () => showLogs(options.logsFolder));
  handle(IPC.helpPending, () => {
    const pending = feedbackPending;
    feedbackPending = false;
    return pending;
  });
  handle(IPC.menuSettingsPending, () => {
    const pending = settingsPending;
    settingsPending = false;
    return pending;
  });
  let sidebarShown = true;
  const buildMenu = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate({
          dev: !app.isPackaged,
          sidebarShown,
          openSettings: () => {
            settingsPending = true;
            options.showSpark();
            toMainWindow(IPC.menuOpenSettings);
          },
          toggleSidebar: () => toMainWindow(IPC.menuCommand, TOGGLE_SIDEBAR_COMMAND),
          sendFeedback,
          exportDiagnostics: () => void exportFromMenu(options),
          showLogs: () => void showLogs(options.logsFolder),
          paneShortcut: options.paneShortcut,
        }),
      ),
    );
  const onSidebarShown = (event: IpcMainEvent, shown: unknown) => {
    if (!options.trusted(event) || typeof shown !== 'boolean' || shown === sidebarShown) return;
    sidebarShown = shown;
    buildMenu();
  };
  ipcMain.on(IPC.menuSidebarShown, onSidebarShown);
  buildMenu();
  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      ipcMain.off(IPC.menuSidebarShown, onSidebarShown);
    },
  };
}
