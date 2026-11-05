import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import { formatMenu } from './format-menu.ts';

export type MenuPaneShortcut =
  'close_tab' | 'reload' | 'hard_reload' | 'zoom_in' | 'zoom_out' | 'zoom_reset' | 'print';

export interface HelpActions {
  dev: boolean;
  sidebarShown: boolean;
  openSettings: () => void;
  toggleSidebar: () => void;
  sendFeedback: () => void;
  exportDiagnostics: () => void;
  showLogs: () => void;
  paneShortcut: (shortcut: MenuPaneShortcut) => boolean;
}

type WindowAction = (window: BaseWindow) => void;

const ZOOM_LEVEL_STEP = 0.5;

function windowContents(window: BaseWindow) {
  return 'webContents' in window
    ? (window.webContents as { reload(): void; reloadIgnoringCache(): void; zoomLevel: number })
    : null;
}

function changeZoom(window: BaseWindow, change: (level: number) => number): void {
  const contents = windowContents(window);
  if (contents) contents.zoomLevel = change(contents.zoomLevel);
}

function paneFirst(
  actions: HelpActions,
  shortcut: MenuPaneShortcut,
  fallback: WindowAction,
): NonNullable<MenuItemConstructorOptions['click']> {
  return (_item, window) => {
    if (actions.paneShortcut(shortcut) || !window) return;
    fallback(window);
  };
}

function appMenu(actions: HelpActions): MenuItemConstructorOptions {
  return {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: actions.openSettings },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

function developerItems(actions: HelpActions): MenuItemConstructorOptions[] {
  return actions.dev ? [{ role: 'toggleDevTools' }] : [];
}

function zoomItems(actions: HelpActions): MenuItemConstructorOptions[] {
  const zoomIn = paneFirst(actions, 'zoom_in', (window) =>
    changeZoom(window, (level) => level + ZOOM_LEVEL_STEP),
  );
  return [
    {
      label: 'Actual Size',
      accelerator: 'CommandOrControl+0',
      click: paneFirst(actions, 'zoom_reset', (window) => changeZoom(window, () => 0)),
    },
    { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: zoomIn },
    {
      label: 'Zoom In',
      accelerator: 'CommandOrControl+=',
      visible: false,
      acceleratorWorksWhenHidden: true,
      click: zoomIn,
    },
    {
      label: 'Zoom Out',
      accelerator: 'CommandOrControl+-',
      click: paneFirst(actions, 'zoom_out', (window) =>
        changeZoom(window, (level) => level - ZOOM_LEVEL_STEP),
      ),
    },
  ];
}

export function appMenuTemplate(actions: HelpActions): MenuItemConstructorOptions[] {
  return [
    appMenu(actions),
    {
      label: 'File',
      submenu: [
        {
          label: 'Close Window',
          accelerator: 'CommandOrControl+W',
          click: paneFirst(actions, 'close_tab', (window) => window.close()),
        },
        { type: 'separator' },
        {
          label: 'Print…',
          accelerator: 'CommandOrControl+P',
          click: paneFirst(actions, 'print', () => undefined),
        },
      ],
    },
    { role: 'editMenu' },
    formatMenu(),
    {
      label: 'View',
      submenu: [
        {
          label: actions.sidebarShown ? 'Hide Sidebar' : 'Show Sidebar',
          accelerator: 'Control+Command+S',
          registerAccelerator: false,
          click: actions.toggleSidebar,
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CommandOrControl+R',
          click: paneFirst(actions, 'reload', (window) => windowContents(window)?.reload()),
        },
        {
          label: 'Force Reload',
          accelerator: 'Shift+CommandOrControl+R',
          click: paneFirst(actions, 'hard_reload', (window) =>
            windowContents(window)?.reloadIgnoringCache(),
          ),
        },
        ...developerItems(actions),
        { type: 'separator' },
        ...zoomItems(actions),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Send Feedback…', click: actions.sendFeedback },
        { label: 'Export Diagnostics…', click: actions.exportDiagnostics },
        { type: 'separator' },
        { label: 'Show Logs in Finder', click: actions.showLogs },
      ],
    },
  ];
}

export function aboutVersion(
  version: string,
  beta: boolean,
): { applicationVersion: string; version?: string } {
  return beta ? { applicationVersion: version, version: 'Beta' } : { applicationVersion: version };
}
