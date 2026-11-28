import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_SPARK_PARTITION_PREFIX } from '@spark-outpost/contracts';
import { desk, fakeElectron, type FakeSession } from './electron.fixture.ts';
import { notLoadedPage } from './load-state.ts';
import { remoteRequestAllowed, remoteSparkSession } from './partition.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

const ID = '11111111-2222-4333-8444-555555555555';
const HOST = 'studio.tail1234.ts.net';
const API_PORT = 32682;
const TOOL_PORT = 61884;
const guards = { blockedPorts: () => new Set([API_PORT, 55050, TOOL_PORT]), log: () => undefined };
const facts = { hostname: HOST, blockedPorts: guards.blockedPorts() };

function opened(): FakeSession {
  return remoteSparkSession(ID, HOST, guards) as unknown as FakeSession;
}

beforeEach(() => desk.reset());

describe('the remote Spark session', () => {
  it('lives in its own in-memory partition under the remote prefix', () => {
    const target = opened();
    expect(target.partition).toBe(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`);
    expect(target.partition.startsWith('persist:')).toBe(false);
    expect(target).not.toBe(fakeElectron.session.defaultSession);
  });

  it('refuses to run on the app session', () => {
    const spy = vi
      .spyOn(fakeElectron.session, 'fromPartition')
      .mockReturnValueOnce(fakeElectron.session.defaultSession);
    expect(() => remoteSparkSession(ID, HOST, guards)).toThrow(/never uses the app session/);
    spy.mockRestore();
  });

  it('refuses an empty id', () => {
    expect(() => remoteSparkSession('', HOST, guards)).toThrow(/own session name/);
  });

  it('cancels requests to Spark’s own ports whatever the host name', () => {
    const target = opened();
    expect(target.requestCancelled(`http://127.0.0.1:${API_PORT}/api/health`)).toBe(true);
    expect(target.requestCancelled(`http://localhost:${TOOL_PORT}/mcp`)).toBe(true);
    expect(target.requestCancelled(`https://${HOST}:${API_PORT}/api/health`)).toBe(true);
    expect(target.requestCancelled(`ws://evil.example:55050/`)).toBe(true);
    expect(target.requestCancelled(`https://${HOST}/api/chats`)).toBe(false);
    expect(target.requestCancelled(`wss://${HOST}/api/stream`)).toBe(false);
  });

  it('strips the launch token header in any spelling', () => {
    const sent = opened().headersSent({ 'X-Spark-Token': 'secret', Accept: 'text/html' });
    expect(sent).toEqual({ Accept: 'text/html' });
    expect(opened().headersSent({ 'x-spark-token': 'secret' })).toEqual({});
  });

  it('denies permissions and device access, and cancels downloads', () => {
    const target = opened();
    for (const permission of ['notifications', 'media', 'geolocation', 'clipboard-read']) {
      expect(target.permissionAnswers(permission)).toEqual({
        request: false,
        check: false,
        device: false,
      });
    }
    expect(target.downloadCancelled()).toBe(true);
  });

  it('keeps one download guard when the window opens again', () => {
    opened();
    expect(opened().listenerCount('will-download')).toBe(1);
  });
});

describe('a request from the remote Spark window', () => {
  const page = (url: string) => remoteRequestAllowed({ url, resourceType: 'mainFrame' }, facts);
  const part = (url: string) => remoteRequestAllowed({ url, resourceType: 'image' }, facts);

  it('loads only the saved origin as the page', () => {
    expect(page(`https://${HOST}/`)).toBe(true);
    expect(page(`https://${HOST}/chats/1?x=1#y`)).toBe(true);
    expect(page(`http://${HOST}/`)).toBe(false);
    expect(page(`https://${HOST}:8443/`)).toBe(false);
    expect(page(`https://other.tail1234.ts.net/`)).toBe(false);
    expect(page('data:text/html,<p>hi</p>')).toBe(false);
    expect(page(notLoadedPage('Studio Mac', HOST, `https://${HOST}/`))).toBe(true);
    expect(page('blob:https://studio.tail1234.ts.net/1')).toBe(false);
    expect(page('file:///etc/passwd')).toBe(false);
  });

  it('loads Cloudflare\u2019s sign-in page for a custom domain alone', () => {
    const signIn = 'https://team-1.cloudflareaccess.com/cdn-cgi/access/login/spark.example.com';
    const custom = { ...facts, hostname: 'spark.example.com' };
    const request = { url: signIn, resourceType: 'mainFrame' };
    expect(remoteRequestAllowed(request, custom)).toBe(true);
    expect(remoteRequestAllowed(request, facts)).toBe(false);
    expect(remoteRequestAllowed({ ...request, url: 'https://example.com/' }, custom)).toBe(false);
  });

  it('never loads a file or an unknown scheme as part of a page', () => {
    expect(part('file:///etc/passwd')).toBe(false);
    expect(part('chrome://settings')).toBe(false);
    expect(part('not a url')).toBe(false);
    expect(part('data:image/png;base64,AAAA')).toBe(true);
    expect(part(`https://${HOST}/logo.png`)).toBe(true);
  });
});
