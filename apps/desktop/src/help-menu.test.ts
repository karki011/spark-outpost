import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { aboutVersion, appMenuTemplate, releaseStage, type HelpActions } from './help-menu.ts';

function actions(change: Partial<HelpActions> = {}): HelpActions {
  return {
    dev: false,
    sidebarShown: true,
    openSettings: () => undefined,
    lockAvailable: false,
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

describe('Lock Spark Outpost', () => {
  const lockItem = (change: Partial<HelpActions>) =>
    submenu(appMenuTemplate(actions(change)), 'appMenu').find(
      (item) => item.label === 'Lock Spark Outpost',
    )!;

  it('sits right after Settings… with ⇧⌘L', () => {
    const app = submenu(appMenuTemplate(actions()), 'appMenu');
    const settings = app.findIndex((item) => item.label === 'Settings…');
    expect(app[settings + 1]).toMatchObject({
      label: 'Lock Spark Outpost',
      accelerator: 'Shift+CommandOrControl+L',
    });
  });

  it('is dimmed until the privacy screen is on with a code', () => {
    expect(lockItem({ lockAvailable: false }).enabled).toBe(false);
    expect(lockItem({ lockAvailable: true }).enabled).toBe(true);
  });

  it('locks when chosen', () => {
    let locked = 0;
    const item = lockItem({ lockAvailable: true, lockNow: () => (locked += 1) });
    (item.click as () => void)();
    expect(locked).toBe(1);
  });
});

describe('the menus while Spark Outpost is locked', () => {
  const flat = (change: Partial<HelpActions>) =>
    appMenuTemplate(actions(change)).flatMap(
      (menu) => (Array.isArray(menu.submenu) ? menu.submenu : []) as MenuItemConstructorOptions[],
    );
  const disabled = (change: Partial<HelpActions>) =>
    flat(change)
      .filter((item) => item.enabled === false)
      .map((item) => item.label);

  it('dims everything that acts on the app, and keeps Lock, Hide, Quit, Edit and Window', () => {
    expect(disabled({ locked: true, lockAvailable: true })).toEqual([
      'Settings…',
      'Print…',
      'Bold',
      'Italic',
      'Strikethrough',
      'Code',
      'Add Link…',
      'Hide Sidebar',
      'Send Feedback…',
      'Export Diagnostics…',
      'Show Logs in Finder',
    ]);
    const roles = appMenuTemplate(actions({ locked: true })).map((menu) => menu.role);
    expect(roles).toEqual(expect.arrayContaining(['appMenu', 'editMenu', 'windowMenu']));
  });

  it('dims none of them while unlocked', () => {
    expect(disabled({ locked: false, lockAvailable: true })).toEqual([]);
  });

  it('sends no key to a browser pane tab while locked', () => {
    const sent: string[] = [];
    const paneShortcut = (shortcut: string) => sent.push(shortcut) > 0;
    const items = flat({ locked: true, paneShortcut });
    for (const label of ['Reload', 'Zoom In', 'Print…']) {
      const item = items.find((each) => each.label === label)!;
      (item.click as (item: unknown, window: unknown) => void)({}, undefined);
    }
    expect(sent).toEqual([]);
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
      'Shift+CommandOrControl+L',
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
      'Lock Spark Outpost',
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
    expect(aboutVersion('0.1.0-beta.1', 'Beta')).toEqual({
      applicationVersion: '0.1.0-beta.1',
      version: 'Beta',
    });
    expect(aboutVersion('0.1.0', null)).toEqual({ applicationVersion: '0.1.0' });
  });
});

describe('releaseStage', () => {
  it('calls every Windows build an alpha and a Mac beta version a beta', () => {
    expect(releaseStage(true, 'win32')).toBe('Alpha');
    expect(releaseStage(false, 'win32')).toBe('Alpha');
    expect(releaseStage(true, 'darwin')).toBe('Beta');
    expect(releaseStage(false, 'darwin')).toBeNull();
  });
});
