import { beforeEach, describe, expect, it } from 'vitest';
import { FakeContents } from './electron.fixture.ts';
import { guardRemoteNavigation, remoteNavigation } from './navigation.ts';

const HOST = 'studio.tail1234.ts.net';
const CUSTOM = 'spark.example.com';
const SIGN_IN = 'https://team-1.cloudflareaccess.com/cdn-cgi/access/login/spark.example.com?kid=1';

describe('where a remote Spark window may go', () => {
  it('stays on the saved origin', () => {
    expect(remoteNavigation(`https://${HOST}/`, HOST)).toBe('allow');
    expect(remoteNavigation(`https://${HOST}/chats/1#code=1`, HOST)).toBe('allow');
    expect(remoteNavigation(`https://${HOST.toUpperCase()}/`, HOST)).toBe('allow');
  });

  it('may show Cloudflare\u2019s sign-in page in front of a custom domain, never a Tailscale one', () => {
    expect(remoteNavigation(SIGN_IN, CUSTOM)).toBe('allow');
    expect(remoteNavigation(SIGN_IN, HOST)).toBe('external');
    expect(remoteNavigation('https://team.cloudflareaccess.com.evil.example/', CUSTOM)).toBe(
      'external',
    );
  });

  it('sends another web origin to the default browser', () => {
    expect(remoteNavigation('https://example.com/docs', HOST)).toBe('external');
    expect(remoteNavigation(`http://${HOST}/`, HOST)).toBe('external');
    expect(remoteNavigation(`https://${HOST}:8443/`, HOST)).toBe('external');
    expect(remoteNavigation(`https://${HOST}.evil.example/`, HOST)).toBe('external');
  });

  it('refuses every other scheme and an address with a login in it', () => {
    expect(remoteNavigation('file:///etc/passwd', HOST)).toBe('refuse');
    expect(remoteNavigation('data:text/html,<p>hi</p>', HOST)).toBe('refuse');
    expect(remoteNavigation('javascript:alert(1)', HOST)).toBe('refuse');
    expect(remoteNavigation('spark://open', HOST)).toBe('refuse');
    expect(remoteNavigation('about:blank', HOST)).toBe('refuse');
    expect(remoteNavigation(`https://user:pass@${HOST}/`, HOST)).toBe('refuse');
    expect(remoteNavigation('not a url', HOST)).toBe('refuse');
  });
});

describe('the navigation guard on a remote Spark window', () => {
  let contents: FakeContents;
  let external: string[];

  beforeEach(() => {
    contents = new FakeContents();
    external = [];
    guardRemoteNavigation(contents, HOST, (url) => external.push(url));
  });

  it('lets a same-origin navigation and redirect through', () => {
    expect(contents.navigates(`https://${HOST}/chats`)).toBe(true);
    expect(contents.redirects(`https://${HOST}/pair`)).toBe(true);
    expect(external).toEqual([]);
  });

  it('cancels a link to another origin and opens it in the default browser', () => {
    expect(contents.navigates('https://example.com/docs')).toBe(false);
    expect(external).toEqual(['https://example.com/docs']);
  });

  it('follows a custom domain\u2019s redirect to Cloudflare\u2019s sign-in page and back', () => {
    const custom = new FakeContents();
    guardRemoteNavigation(custom, CUSTOM, (url) => external.push(url));
    expect(custom.redirects(SIGN_IN)).toBe(true);
    expect(custom.navigates(SIGN_IN)).toBe(true);
    expect(custom.redirects(`https://${CUSTOM}/cdn-cgi/access/authorized?nonce=1`)).toBe(true);
    expect(contents.redirects(SIGN_IN)).toBe(false);
    expect(external).toEqual([]);
  });

  it('cancels a redirect to another origin without opening anything', () => {
    expect(contents.redirects('https://example.com/landing')).toBe(false);
    expect(external).toEqual([]);
  });

  it('cancels other schemes without opening anything', () => {
    expect(contents.navigates('file:///etc/passwd')).toBe(false);
    expect(contents.navigates('data:text/html,<p>hi</p>')).toBe(false);
    expect(contents.windowOpen('file:///etc/passwd')).toBe('deny');
    expect(external).toEqual([]);
  });

  it('denies every popup, sending a web one to the default browser', () => {
    expect(contents.windowOpen(`https://${HOST}/chats`)).toBe('deny');
    expect(contents.windowOpen('https://example.com/help')).toBe('deny');
    expect(external).toEqual(['https://example.com/help']);
  });

  it('never lets the page keep the window from closing', () => {
    expect(contents.unloadBlocked()).toBe(false);
  });
});
