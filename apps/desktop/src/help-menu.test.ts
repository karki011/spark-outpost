import { describe, expect, it } from 'vitest';
import { aboutVersion, appMenuTemplate } from './help-menu.ts';

describe('appMenuTemplate', () => {
  it('keeps the standard menus and adds feedback, diagnostics and logs to Help', () => {
    const calls: string[] = [];
    const template = appMenuTemplate({
      sendFeedback: () => calls.push('feedback'),
      exportDiagnostics: () => calls.push('diagnostics'),
      showLogs: () => calls.push('logs'),
    });
    expect(template.map((item) => item.role)).toEqual([
      'appMenu',
      'fileMenu',
      'editMenu',
      'viewMenu',
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

describe('aboutVersion', () => {
  it('labels beta builds in the About panel', () => {
    expect(aboutVersion('0.1.0-beta.1', true)).toEqual({
      applicationVersion: '0.1.0-beta.1',
      version: 'Beta',
    });
    expect(aboutVersion('0.1.0', false)).toEqual({ applicationVersion: '0.1.0' });
  });
});
