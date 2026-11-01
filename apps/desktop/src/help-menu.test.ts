import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { aboutVersion, appMenuTemplate, type HelpActions } from './help-menu.ts';

function actions(change: Partial<HelpActions> = {}): HelpActions {
  return {
    dev: false,
    sidebarShown: true,
    openSettings: () => undefined,
    toggleSidebar: () => undefined,
    sendFeedback: () => undefined,
    exportDiagnostics: () => undefined,
    showLogs: () => undefined,
    paneShortcut: () => false,
    ...change,
  };
}

function submenu(template: MenuItemConstructorOptions[], name: string) {
  const menu = template.find((item) => (item.role ?? item.label) === name);
  return (menu?.submenu ?? []) as MenuItemConstructorOptions[];
}

const names = (items: MenuItemConstructorOptions[]) =>
  items.map((item) => item.role ?? item.label ?? item.type);

describe('appMenuTemplate', () => {
  it('keeps the standard menus and adds feedback, diagnostics and logs to Help', () => {
    const calls: string[] = [];
    const template = appMenuTemplate(
      actions({
        sendFeedback: () => calls.push('feedback'),
        exportDiagnostics: () => calls.push('diagnostics'),
        showLogs: () => calls.push('logs'),
      }),
    );
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'appMenu',
      'File',
      'editMenu',
      'Format',
      'View',
      'windowMenu',
      'help',
    ]);
    const help = template.at(-1)!.submenu as { label?: string; click?: () => void }[];
    expect(help.map((item) => item.label)).toEqual([
      'Send Feedback…',
      'Export Diagnostics…',
      undefined,
      'Show Logs in Finder',
    ]);
    for (const item of help) item.click?.();
    expect(calls).toEqual(['feedback', 'diagnostics', 'logs']);
  });
});

describe('Close Window, Reload and Force Reload', () => {
  type Item = {
    label?: string;
    accelerator?: string;
    registerAccelerator?: boolean;
    visible?: boolean;
    click?: (...args: unknown[]) => void;
  };
  const items = (paneShortcut: (shortcut: string) => boolean) => {
    const template = appMenuTemplate(actions({ paneShortcut }));
    return template.flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : [])) as Item[];
  };
  const fakeWindow = (did: string[]) => ({
    close: () => did.push('close'),
    webContents: {
      zoomLevel: 1,
      reload: () => did.push('reload'),
      reloadIgnoringCache: () => did.push('hard_reload'),
    },
  });
  const press = (all: Item[], label: string, window: unknown) =>
    all.find((item) => item.label === label)!.click!({}, window, {});

  it('go to the Browser pane when one of its pages has the focus', () => {
    const asked: string[] = [];
    const did: string[] = [];
    const all = items((shortcut) => {
      asked.push(shortcut);
      return true;
    });
    for (const label of ['Close Window', 'Reload', 'Force Reload'])
      press(all, label, fakeWindow(did));
    expect(asked).toEqual(['close_tab', 'reload', 'hard_reload']);
    expect(did).toEqual([]);
  });

  it('zoom and print the focused page, and otherwise zoom the app and print nothing', () => {
    const labels = ['Zoom In', 'Zoom Out', 'Actual Size', 'Print…'];
    const asked: string[] = [];
    const pane = items((shortcut) => {
      asked.push(shortcut);
      return true;
    });
    const window = fakeWindow([]);
    for (const label of labels) press(pane, label, window);
    expect(asked).toEqual(['zoom_in', 'zoom_out', 'zoom_reset', 'print']);
    expect(window.webContents.zoomLevel).toBe(1);

    const app = items(() => false);
    press(app, 'Zoom In', window);
    expect(window.webContents.zoomLevel).toBe(1.5);
    press(app, 'Zoom Out', window);
    press(app, 'Zoom Out', window);
    expect(window.webContents.zoomLevel).toBe(0.5);
    press(app, 'Actual Size', window);
    expect(window.webContents.zoomLevel).toBe(0);
    expect(() => press(app, 'Print…', window)).not.toThrow();
  });

  it('take Command-equals as Zoom In too, without a second menu row', () => {
    const hidden = items(() => false).filter((item) => item.accelerator === 'CommandOrControl+=');
    expect(hidden.map((item) => [item.label, item.visible])).toEqual([['Zoom In', false]]);
  });

  it('act on the window otherwise, with the usual keys', () => {
    const did: string[] = [];
    const all = items(() => false);
    for (const label of ['Close Window', 'Reload', 'Force Reload'])
      press(all, label, fakeWindow(did));
    expect(did).toEqual(['close', 'reload', 'hard_reload']);
    const registered = all.filter((item) => item.accelerator && item.registerAccelerator !== false);
    expect(registered.map((item) => item.accelerator)).toEqual([
      'CommandOrControl+,',
      'CommandOrControl+W',
      'CommandOrControl+P',
      'CommandOrControl+R',
      'Shift+CommandOrControl+R',
      'CommandOrControl+0',
      'CommandOrControl+Plus',
      'CommandOrControl+=',
      'CommandOrControl+-',
    ]);
  });
});

describe('the app menu', () => {
  it('puts Settings… with ⌘, right under About, before Services, Hide and Quit', () => {
    let opened = 0;
    const app = submenu(appMenuTemplate(actions({ openSettings: () => (opened += 1) })), 'appMenu');
    expect(names(app)).toEqual([
      'about',
      'separator',
      'Settings…',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    const settings = app.find((item) => item.label === 'Settings…')!;
    expect(settings.accelerator).toBe('CommandOrControl+,');
    (settings.click as () => void)();
    expect(opened).toBe(1);
  });
});

describe('the View menu', () => {
  const sidebarItem = (change: Partial<HelpActions>) =>
    submenu(appMenuTemplate(actions(change)), 'View')[0]!;

  it('starts with Show or Hide Sidebar on ⌃⌘S, named for what it will do', () => {
    let toggled = 0;
    const hide = sidebarItem({ sidebarShown: true, toggleSidebar: () => (toggled += 1) });
    expect(hide.label).toBe('Hide Sidebar');
    expect(hide.accelerator).toBe('Control+Command+S');
    expect(hide.registerAccelerator).toBe(false);
    (hide.click as () => void)();
    expect(toggled).toBe(1);
    expect(sidebarItem({ sidebarShown: false }).label).toBe('Show Sidebar');
  });

  it('offers Toggle Developer Tools only in a dev build', () => {
    const view = (dev: boolean) => names(submenu(appMenuTemplate(actions({ dev })), 'View'));
    expect(view(true)).toContain('toggleDevTools');
    expect(view(false)).not.toContain('toggleDevTools');
    expect(view(false)).toEqual([
      'Hide Sidebar',
      'separator',
      'Reload',
      'Force Reload',
      'separator',
      'Actual Size',
      'Zoom In',
      'Zoom In',
      'Zoom Out',
    ]);
  });
});

describe('aboutVersion', () => {
  it('labels beta builds in the About panel', () => {
    expect(aboutVersion('0.1.0-beta.1', true)).toEqual({
      applicationVersion: '0.1.0-beta.1',
      version: 'Beta',
    });
    expect(aboutVersion('0.1.0', false)).toEqual({ applicationVersion: '0.1.0' });
  });
});
