import type { MenuItemConstructorOptions } from 'electron';

export interface HelpActions {
  sendFeedback: () => void;
  exportDiagnostics: () => void;
  showLogs: () => void;
}

export function appMenuTemplate(actions: HelpActions): MenuItemConstructorOptions[] {
  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
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
