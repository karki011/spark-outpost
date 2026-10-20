import { describe, expect, it } from 'vitest';
import { aboutVersion, appMenuTemplate } from './help-menu.ts';

describe('appMenuTemplate', () => {
  it('keeps the standard menus and adds feedback, diagnostics and logs to Help', () => {
    const calls: string[] = [];
    const template = appMenuTemplate({
      sendFeedback: () => calls.push('feedback'),
      exportDiagnostics: () => calls.push('diagnostics'),
      showLogs: () => calls.push('logs'),
      paneShortcut: () => false,
    });
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      'appMenu',
      'File',
      'editMenu',
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
  type Item = { label?: string; accelerator?: string; click?: (...args: unknown[]) => void };
  const items = (paneShortcut: (shortcut: string) => boolean) => {
    const template = appMenuTemplate({
      sendFeedback: () => undefined,
      exportDiagnostics: () => undefined,
      showLogs: () => undefined,
      paneShortcut,
    });
    return template.flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : [])) as Item[];
  };
  const fakeWindow = (did: string[]) => ({
    close: () => did.push('close'),
    webContents: {
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

  it('act on the window otherwise, with the usual keys', () => {
    const did: string[] = [];
    const all = items(() => false);
    for (const label of ['Close Window', 'Reload', 'Force Reload'])
      press(all, label, fakeWindow(did));
    expect(did).toEqual(['close', 'reload', 'hard_reload']);
    expect(all.filter((item) => item.accelerator).map((item) => item.accelerator)).toEqual([
      'CommandOrControl+W',
      'CommandOrControl+R',
      'Shift+CommandOrControl+R',
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
