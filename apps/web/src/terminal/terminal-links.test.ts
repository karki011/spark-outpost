import { describe, expect, it, vi } from 'vitest';
import { menuLinkUrl, openTerminalLink, terminalLinkTarget } from './terminal-links.ts';

describe('openTerminalLink', () => {
  it('opens http and https links in a new tab without opener or referrer', () => {
    const open = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(openTerminalLink(event, 'https://console.anthropic.com/settings/keys', open)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      'https://console.anthropic.com/settings/keys',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('refuses other protocols and malformed links', () => {
    const open = vi.fn();
    const event = { preventDefault: vi.fn() };
    expect(openTerminalLink(event, 'javascript:alert(1)', open)).toBe(false);
    expect(openTerminalLink(event, 'file:///etc/passwd', open)).toBe(false);
    expect(openTerminalLink(event, 'not a url', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('where a link in a Terminal session opens', () => {
  const roots = [{ id: 'p1', rootPath: '/work/repo' }];
  const mac = { pane: true, appOrigin: 'http://127.0.0.1:5173', roots };
  const web = { ...mac, pane: false };

  it('opens a web address in the Browser pane on a click', () => {
    expect(terminalLinkTarget('https://example.com/a?b=1#c', mac, 'pane')).toEqual({
      open: 'pane',
      url: 'https://example.com/a?b=1#c',
    });
    expect(terminalLinkTarget('http://localhost:3000/', mac, 'pane')).toEqual({
      open: 'pane',
      url: 'http://localhost:3000/',
    });
  });

  it('opens it in the default browser when that was asked for or there is no pane', () => {
    const outside = { open: 'browser', url: 'https://example.com/' };
    expect(terminalLinkTarget('https://example.com', mac, 'browser')).toEqual(outside);
    expect(terminalLinkTarget('https://example.com', web, 'pane')).toEqual(outside);
  });

  it("hands Spark's own address to the pane, which blocks it, and never to the default browser", () => {
    const own = 'http://127.0.0.1:5173/api/conversations';
    expect(terminalLinkTarget(own, mac, 'pane')).toEqual({ open: 'pane', url: own });
    expect(terminalLinkTarget(own, mac, 'browser')).toBeNull();
    expect(terminalLinkTarget(own, web, 'pane')).toBeNull();
  });

  it('refuses other schemes, addresses with a login in them and text that is not an address', () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ssh://host',
      'vscode://file/x',
      'https://user:pw@example.com/',
      'not a url',
      '',
    ]) {
      expect(terminalLinkTarget(uri, mac, 'pane')).toBeNull();
      expect(terminalLinkTarget(uri, mac, 'browser')).toBeNull();
      expect(menuLinkUrl(uri)).toBeNull();
    }
  });

  it("opens a file link inside one of the chat's projects in the file view", () => {
    expect(terminalLinkTarget('file:///work/repo/src/a%20b.ts', mac, 'pane')).toEqual({
      open: 'file',
      projectId: 'p1',
      path: 'src/a b.ts',
    });
    expect(terminalLinkTarget('file://my-mac.local/work/repo/README.md', web, 'pane')).toEqual({
      open: 'file',
      projectId: 'p1',
      path: 'README.md',
    });
  });

  it('leaves a file link outside the projects, the folder itself and a path that climbs out alone', () => {
    expect(terminalLinkTarget('file:///etc/passwd', mac, 'pane')).toBeNull();
    expect(terminalLinkTarget('file:///work/repo', mac, 'pane')).toBeNull();
    expect(terminalLinkTarget('file:///work/repo-other/x', mac, 'pane')).toBeNull();
    expect(terminalLinkTarget('file:///work/repo/%2e%2e/secret', mac, 'pane')).toBeNull();
    expect(menuLinkUrl('file:///work/repo/src/a.ts')).toBeNull();
  });
});
