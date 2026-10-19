import { describe, expect, it } from 'vitest';
import { BROWSER_TABS_MAX, type BrowserPaneTab } from '@spark-outpost/contracts';
import {
  defaultBrowserUrl,
  isPlainClick,
  linkAction,
  paneCommands,
  paneUrl,
  type ClickFacts,
  type LinkFacts,
} from './chat-links.ts';

function tab(id: string, change: Partial<BrowserPaneTab> = {}): BrowserPaneTab {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    owner: 'user',
    active: false,
    place: 'external',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    kept: false,
    handoff: null,
    driving: false,
    picking: false,
    lastAction: null,
    error: null,
    ...change,
  };
}

const plain: ClickFacts = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

const link = (href: string | null, change: Partial<LinkFacts> = {}): LinkFacts => ({
  href,
  inChat: true,
  download: false,
  ...change,
});

describe('which addresses the Browser pane takes', () => {
  it('takes http and https pages, local or not', () => {
    expect(paneUrl('https://github.com/acme/app/pull/7')).toBe(
      'https://github.com/acme/app/pull/7',
    );
    expect(paneUrl('http://example.com')).toBe('http://example.com/');
    expect(paneUrl('  HTTPS://Example.com/a?b=1#c ')).toBe('https://example.com/a?b=1#c');
    expect(paneUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
  });

  it('takes an address on one of Spark’s own ports, so the pane shows its refusal', () => {
    expect(paneUrl('http://127.0.0.1:47600/api/health')).toBe('http://127.0.0.1:47600/api/health');
  });

  it('leaves every other scheme to the system', () => {
    for (const href of [
      'mailto:someone@example.com',
      'tel:+15550100',
      'file:///Users/me/notes.txt',
      'vscode://file/Users/me/app.ts',
      'slack://channel?team=T1',
      'javascript:alert(1)',
      'data:text/html,hello',
      'about:blank',
    ]) {
      expect(paneUrl(href)).toBeNull();
    }
  });

  it('leaves in-app links alone: guide pages, anchors and Spark’s own files', () => {
    for (const href of ['#/docs/use-the-browser', '#turn-3', '/api/attachments/1/content', '']) {
      expect(paneUrl(href)).toBeNull();
    }
    expect(paneUrl(null)).toBeNull();
  });

  it('never sends an address that carries a sign-in, or one too long to hold', () => {
    expect(paneUrl('https://user:secret@example.com/')).toBeNull();
    expect(paneUrl(`https://example.com/${'a'.repeat(5000)}`)).toBeNull();
    expect(paneUrl('https://')).toBeNull();
  });
});

describe('which addresses the default browser is offered', () => {
  const app = 'http://127.0.0.1:47600';

  it('offers web pages', () => {
    expect(defaultBrowserUrl('https://example.com/a', app)).toBe('https://example.com/a');
    expect(defaultBrowserUrl('http://localhost:5173/', app)).toBe('http://localhost:5173/');
  });

  it('never offers Spark’s own address, an empty tab or a file', () => {
    expect(defaultBrowserUrl('http://127.0.0.1:47600/api/health', app)).toBeNull();
    expect(defaultBrowserUrl('', app)).toBeNull();
    expect(defaultBrowserUrl('file:///Users/me/app/index.html', app)).toBeNull();
  });
});

describe('a click on a link', () => {
  it('is plain only with the main button and no modifier', () => {
    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, defaultPrevented: true })).toBe(false);
  });

  it('opens a chat link in the pane', () => {
    expect(linkAction(plain, link('https://example.com/a'), true)).toEqual({
      open: 'pane',
      url: 'https://example.com/a',
    });
  });

  it('is left to the system with Command, Control, Shift or the middle button', () => {
    const href = link('https://example.com/a');
    expect(linkAction({ ...plain, metaKey: true }, href, true)).toEqual({ open: 'native' });
    expect(linkAction({ ...plain, ctrlKey: true }, href, true)).toEqual({ open: 'native' });
    expect(linkAction({ ...plain, shiftKey: true }, href, true)).toEqual({ open: 'native' });
    expect(linkAction({ ...plain, button: 1 }, href, true)).toEqual({ open: 'native' });
  });

  it('is left alone when something else already handled it', () => {
    expect(
      linkAction({ ...plain, defaultPrevented: true }, link('https://example.com/a'), true),
    ).toEqual({ open: 'native' });
  });

  it('is left alone where there is no Browser pane: the web app and a paired phone', () => {
    expect(linkAction(plain, link('https://example.com/a'), false)).toEqual({ open: 'native' });
  });

  it('is left alone outside a chat: Settings, onboarding, Integrations, Phone, Docs', () => {
    expect(linkAction(plain, link('https://github.com/login', { inChat: false }), true)).toEqual({
      open: 'native',
    });
  });

  it('is left alone for downloads, other schemes and in-app links', () => {
    expect(linkAction(plain, link('https://example.com/a.zip', { download: true }), true)).toEqual({
      open: 'native',
    });
    expect(linkAction(plain, link('mailto:someone@example.com'), true)).toEqual({ open: 'native' });
    expect(linkAction(plain, link('#/docs/use-the-browser'), true)).toEqual({ open: 'native' });
    expect(linkAction(plain, link('/api/attachments/1/content'), true)).toEqual({
      open: 'native',
    });
  });
});

describe('where the page goes in the pane', () => {
  const url = 'https://example.com/new';

  it('opens a new tab', () => {
    expect(paneCommands(url, [tab('t1', { active: true })])).toEqual([{ command: 'new_tab', url }]);
    expect(paneCommands(url, [])).toEqual([{ command: 'new_tab', url }]);
  });

  it('shows the tab that is already on exactly that address', () => {
    const tabs = [tab('t1', { active: true }), tab('t2', { url }), tab('t3', { url: `${url}?x` })];
    expect(paneCommands(url, tabs)).toEqual([{ command: 'select', tabId: 't2' }]);
  });

  it('replaces the empty tab that is showing', () => {
    const tabs = [tab('t1'), tab('t2', { url: '', active: true })];
    expect(paneCommands(url, tabs)).toEqual([
      { command: 'close', tabId: 't2' },
      { command: 'new_tab', url },
    ]);
  });

  it('keeps an empty tab that is in the background or still shows a failure', () => {
    expect(paneCommands(url, [tab('t1', { active: true }), tab('t2', { url: '' })])).toEqual([
      { command: 'new_tab', url },
    ]);
    expect(paneCommands(url, [tab('t1', { url: '', active: true, error: 'No' })])).toEqual([
      { command: 'new_tab', url },
    ]);
  });

  it('uses the showing tab when no more tabs fit', () => {
    const full = Array.from({ length: BROWSER_TABS_MAX }, (_, index) =>
      tab(`t${index}`, { active: index === 3 }),
    );
    expect(paneCommands(url, full)).toEqual([{ command: 'navigate', tabId: 't3', url }]);
  });
});
