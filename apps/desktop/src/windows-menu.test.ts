import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import type { HelpActions } from './help-menu.ts';
import { menuTemplateFor, windowsMenuTemplate } from './windows-menu.ts';

function actions(change: Partial<HelpActions> = {}): HelpActions {
  return {
    dev: false,
    sidebarShown: true,
    openSettings: () => undefined,
    lockAvailable: true,
    locked: false,
    lockNow: () => undefined,
    toggleSidebar: () => undefined,
    sendFeedback: () => undefined,
    exportDiagnostics: () => undefined,
    showLogs: () => undefined,
    paneShortcut: () => false,
    ...change,
  };
}

function shape(items: MenuItemConstructorOptions[]): unknown[] {
  return items.map((item) => {
    const name = item.role ?? item.label ?? item.type;
    const sub = Array.isArray(item.submenu) ? shape(item.submenu) : null;
    const named = item.accelerator ? `${name} ${item.accelerator}` : name;
    return sub ? [named, sub] : named;
  });
}

const MAC_MENU = [
  [
    'appMenu',
    [
      'about',
      'separator',
      'Settings… CommandOrControl+,',
      'Lock Spark Outpost Shift+CommandOrControl+L',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ],
  ],
  ['File', ['Close Window CommandOrControl+W', 'separator', 'Print… CommandOrControl+P']],
  'editMenu',
  [
    'Format',
    [
      'Bold CommandOrControl+B',
      'Italic CommandOrControl+I',
      'Strikethrough Shift+CommandOrControl+X',
      'Code',
      'separator',
      'Add Link…',
    ],
  ],
  [
    'View',
    [
      'Hide Sidebar Control+Command+S',
      'separator',
      'Reload CommandOrControl+R',
      'Force Reload Shift+CommandOrControl+R',
      'separator',
      'Actual Size CommandOrControl+0',
      'Zoom In CommandOrControl+Plus',
      'Zoom In CommandOrControl+=',
      'Zoom Out CommandOrControl+-',
    ],
  ],
  'windowMenu',
  ['help', ['Send Feedback…', 'Export Diagnostics…', 'separator', 'Show Logs in Finder']],
];

describe('menuTemplateFor', () => {
  it('keeps the exact Mac menu on macOS', () => {
    expect(shape(menuTemplateFor('darwin', actions()))).toEqual(MAC_MENU);
  });

  it('gives Windows File, Edit, View, Format and Help with no app menu', () => {
    const template = menuTemplateFor('win32', actions());
    expect(template.map((item) => item.label)).toEqual([
      '&File',
      '&Edit',
      '&View',
      'F&ormat',
      '&Help',
    ]);
    expect(template.some((item) => item.role === 'appMenu' || item.role === 'windowMenu')).toBe(
      false,
    );
  });

  it('puts Settings and Exit under File and About under Help on Windows', () => {
    const [file, , view, , help] = windowsMenuTemplate(actions());
    expect(shape([file!])).toEqual([
      [
        '&File',
        [
          '&Settings… Control+,',
          '&Lock Spark Outpost Control+Shift+L',
          'separator',
          '&Print… Control+P',
          'separator',
          '&Close Window Control+W',
          'quit',
        ],
      ],
    ]);
    const fileItems = file!.submenu as MenuItemConstructorOptions[];
    expect(fileItems.at(-1)!.label).toBe('E&xit');
    const viewItems = view!.submenu as MenuItemConstructorOptions[];
    expect(viewItems[0]!.accelerator).toBe('Control+Alt+S');
    const helpItems = help!.submenu as MenuItemConstructorOptions[];
    expect(helpItems.map((item) => item.label)).toContain('Show &Logs in File Explorer');
    expect(helpItems.at(-1)!.role).toBe('about');
  });

  it('turns off Settings and Print while Spark is locked', () => {
    const [file] = windowsMenuTemplate(actions({ locked: true }));
    const items = file!.submenu as MenuItemConstructorOptions[];
    expect(items.find((item) => item.label === '&Settings…')!.enabled).toBe(false);
    expect(items.find((item) => item.label === '&Print…')!.enabled).toBe(false);
  });

  it('opens Settings from the File menu', () => {
    const calls: string[] = [];
    const [file] = windowsMenuTemplate(actions({ openSettings: () => calls.push('settings') }));
    const settings = (file!.submenu as MenuItemConstructorOptions[])[0]!;
    (settings.click as () => void)();
    expect(calls).toEqual(['settings']);
  });
});
