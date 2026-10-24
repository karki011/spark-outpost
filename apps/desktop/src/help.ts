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
  FEEDBACK_SETTINGS_FOCUS,
  isBetaVersion,
  type DesktopHelpInfo,
  type DiagnosticsExport,
} from '@spark-outpost/contracts';
import { appMenuTemplate, type HelpActions } from './help-menu.ts';
import { IPC } from './ipc-channels.ts';
import { startSettingsWindow } from './settings-window.ts';
import { openRulesFile, userRulesFile } from './spark-rules-file.ts';

const EXPORT_TIMEOUT_MS = 60_000;
const HELP_ROUTE = '#/settings/help';
const TOGGLE_SIDEBAR_COMMAND = 'toggle-sidebar';

export interface HelpOptions {
  version: string;
  logsFolder: string;
  rulesFile: string;
  apiUrl: string;
  token: string;
  trusted: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean;
  showSpark: () => void;
  openChat: (id: string) => void;
  preload: string;
  theme: () => string | null;
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
  IPC.sparkRulesOpenFile,
];

export function startHelp(options: HelpOptions): Help {
  const info: DesktopHelpInfo = {
    version: options.version,
    beta: isBetaVersion(options.version),
    logsFolder: options.logsFolder,
  };
  const toMainWindow = (channel: string, payload: string) => {
    const window = options.mainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const handle = (channel: string, handler: () => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, (event) => (options.trusted(event) ? handler() : null));
  };
  handle(IPC.helpInfo, () => info);
  handle(IPC.helpExportDiagnostics, () => saveDiagnostics(options));
  handle(IPC.helpShowLogs, () => showLogs(options.logsFolder));
  const rulesFile = userRulesFile(process.env, options.rulesFile);
  handle(IPC.sparkRulesOpenFile, () => openRulesFile(rulesFile, shell.openPath));
  let sidebarShown = true;
  const settingsWindow = startSettingsWindow({
    origin: options.apiUrl,
    preload: options.preload,
    theme: options.theme,
    trusted: options.trusted,
    mainWindow: options.mainWindow,
    showSpark: options.showSpark,
    openChat: options.openChat,
  });
  const buildMenu = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate({
          dev: !app.isPackaged,
          sidebarShown,
          openSettings: settingsWindow.show,
          toggleSidebar: () => toMainWindow(IPC.menuCommand, TOGGLE_SIDEBAR_COMMAND),
          sendFeedback: () =>
            settingsWindow.open({ route: HELP_ROUTE, focus: FEEDBACK_SETTINGS_FOCUS }),
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
      settingsWindow.dispose();
    },
  };
}
