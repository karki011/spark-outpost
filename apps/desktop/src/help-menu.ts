import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import { formatMenu } from './format-menu.ts';

export type MenuPaneShortcut = 'close_tab' | 'reload' | 'hard_reload';

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

function windowContents(window: BaseWindow) {
  return 'webContents' in window
    ? (window.webContents as { reload(): void; reloadIgnoringCache(): void })
    : null;
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
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
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
