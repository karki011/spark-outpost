import type { MenuItemConstructorOptions } from 'electron';
import { formatMenu } from './format-menu.ts';
import {
  appMenuTemplate,
  developerItems,
  paneFirst,
  windowContents,
  zoomItems,
  type HelpActions,
} from './help-menu.ts';

function fileMenu(actions: HelpActions): MenuItemConstructorOptions {
  return {
    label: '&File',
    submenu: [
      {
        label: '&Settings…',
        accelerator: 'Control+,',
        enabled: !actions.locked,
        click: actions.openSettings,
      },
      {
        label: '&Lock Spark Outpost',
        accelerator: 'Control+Shift+L',
        enabled: actions.lockAvailable,
        click: actions.lockNow,
      },
      { type: 'separator' },
      {
        label: '&Print…',
        accelerator: 'Control+P',
        enabled: !actions.locked,
        click: paneFirst(actions, 'print', () => undefined),
      },
      { type: 'separator' },
      {
        label: '&Close Window',
        accelerator: 'Control+W',
        click: paneFirst(actions, 'close_tab', (window) => window.close()),
      },
      { role: 'quit', label: 'E&xit' },
    ],
  };
}

function viewMenu(actions: HelpActions): MenuItemConstructorOptions {
  return {
    label: '&View',
    submenu: [
      {
        label: actions.sidebarShown ? 'Hide Sidebar' : 'Show Sidebar',
        accelerator: 'Control+Alt+S',
        registerAccelerator: false,
        enabled: !actions.locked,
        click: actions.toggleSidebar,
      },
      { type: 'separator' },
      {
        label: '&Reload',
        accelerator: 'Control+R',
        click: paneFirst(actions, 'reload', (window) => windowContents(window)?.reload()),
      },
      {
        label: '&Force Reload',
        accelerator: 'Control+Shift+R',
        click: paneFirst(actions, 'hard_reload', (window) =>
          windowContents(window)?.reloadIgnoringCache(),
        ),
      },
      ...developerItems(actions),
      { type: 'separator' },
      ...zoomItems(actions),
    ],
  };
}

function helpMenu(actions: HelpActions): MenuItemConstructorOptions {
  return {
    role: 'help',
    label: '&Help',
    submenu: [
      { label: 'Send &Feedback…', enabled: !actions.locked, click: actions.sendFeedback },
      {
        label: 'Export &Diagnostics…',
        enabled: !actions.locked,
        click: actions.exportDiagnostics,
      },
      { type: 'separator' },
      {
        label: 'Show &Logs in File Explorer',
        enabled: !actions.locked,
        click: actions.showLogs,
      },
      { type: 'separator' },
      { role: 'about', label: '&About Spark Outpost' },
    ],
  };
}

export function windowsMenuTemplate(actions: HelpActions): MenuItemConstructorOptions[] {
  return [
    fileMenu(actions),
    { role: 'editMenu', label: '&Edit' },
    viewMenu(actions),
    formatMenu(!actions.locked, 'F&ormat'),
    helpMenu(actions),
  ];
}

export function menuTemplateFor(
  platform: NodeJS.Platform,
  actions: HelpActions,
): MenuItemConstructorOptions[] {
  return platform === 'win32' ? windowsMenuTemplate(actions) : appMenuTemplate(actions);
}
