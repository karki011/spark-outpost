import { describe, expect, it } from 'vitest';
import {
  AGENT_OPEN_REFUSALS,
  agentOpenProblem,
  insideRoots,
  isBrowserPartition,
  navigationAllowed,
  partitionFor,
  projectPartition,
  requestAllowed,
  withoutSparkToken,
} from './request-guard.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const PROJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const facts = { blockedPorts: new Set([32682, 55050, 61884]), roots: ['/Users/me/app'] };

describe('what a page in the pane may request', () => {
  it('blocks the API, Postgres and Spark tool ports on any host and scheme', () => {
    for (const url of [
      'http://127.0.0.1:32682/api/health',
      'http://localhost:32682/api/conversations',
      'ws://127.0.0.1:32682/api/terminal',
      'http://[::1]:32682/',
      'http://rebind.attacker.example:32682/api/health',
      'http://127.0.0.1:55050/',
      'http://127.0.0.1:61884/mcp',
    ]) {
      expect(requestAllowed(url, facts), url).toBe(false);
    }
  });

  it('allows other local and external pages', () => {
    expect(requestAllowed('http://localhost:5173/', facts)).toBe(true);
    expect(requestAllowed('https://example.com/a.js', facts)).toBe(true);
    expect(requestAllowed('wss://example.com/socket', facts)).toBe(true);
    expect(requestAllowed('data:image/png;base64,AAAA', facts)).toBe(true);
  });

  it('allows files only inside linked projects', () => {
    expect(requestAllowed('file:///Users/me/app/index.html', facts)).toBe(true);
    expect(requestAllowed('file:///Users/me/app/../.ssh/id_rsa', facts)).toBe(false);
    expect(requestAllowed('file:///Users/me/application/index.html', facts)).toBe(false);
    expect(requestAllowed('file:///etc/passwd', facts)).toBe(false);
    expect(requestAllowed('file://server/share/x.html', facts)).toBe(false);
    expect(insideRoots('/Users/me/app', ['/Users/me/app'])).toBe(true);
  });

  it('refuses other schemes', () => {
    expect(requestAllowed('chrome://settings', facts)).toBe(false);
    expect(requestAllowed('ftp://example.com/x', facts)).toBe(false);
  });

  it('drops a launch token a page tries to send', () => {
    expect(
      withoutSparkToken({ Accept: '*/*', 'X-Spark-Token': 'guess', 'x-spark-token': 'guess' }),
    ).toEqual({ Accept: '*/*' });
  });
});

describe('what an agent may open', () => {
  it.each([
    'https://example.com/pricing?plan=pro',
    'http://example.com:8080/',
    'https://xn--bcher-kva.example/',
    'https://bücher.example/katalog',
    'https://[2001:db8::1]/',
    'http://192.168.1.20:3000/',
    'http://localhost:5173/',
    'http://app.test:4000/',
    'file:///Users/me/app/index.html',
  ])('opens %s', (url) => {
    expect(agentOpenProblem(url, facts)).toBeNull();
  });

  it.each([
    'http://127.0.0.1:32682/api/health',
    'http://localhost:55050/',
    'https://rebind.attacker.example:32682/',
    'http://[::1]:61884/mcp',
    'http://0.0.0.0:32682/',
    'http://2130706433:32682/',
  ])('refuses %s, one of Spark’s own ports on any host', (url) => {
    expect(agentOpenProblem(url, facts)).toBe(AGENT_OPEN_REFUSALS.sparkPort);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com/',
    'ftp://example.com/x',
    'blob:https://example.com/1',
    'about:blank',
    'https://user:pass@example.com/',
    'https://user@example.com/',
    'not a url',
    `https://example.com/${'a'.repeat(5000)}`,
  ])('refuses %s as not a web address', (url) => {
    expect(agentOpenProblem(url, facts)).toBe(AGENT_OPEN_REFUSALS.address);
  });

  it('refuses a file outside the chat’s projects', () => {
    expect(agentOpenProblem('file:///etc/passwd', facts)).toBe(AGENT_OPEN_REFUSALS.file);
    expect(agentOpenProblem('file:///Users/me/app/../.ssh/id_rsa', facts)).toBe(
      AGENT_OPEN_REFUSALS.file,
    );
  });
});

describe('where a page may take a tab, by link, script or redirect', () => {
  it('lets a redirect or link go to another web page', () => {
    expect(navigationAllowed('https://other.example/landing')).toBe(true);
    expect(navigationAllowed('http://localhost:5173/')).toBe(true);
  });

  it('stops a redirect to a scheme that is not the web or to an address with a login in it', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'chrome://settings',
      'https://user:pass@example.com/',
    ]) {
      expect(navigationAllowed(url), url).toBe(false);
    }
  });

  it('has every hop of a redirect checked against Spark’s ports and the project folders', () => {
    for (const hop of [
      'http://127.0.0.1:32682/api/conversations',
      'https://rebind.attacker.example:55050/',
      'file:///etc/passwd',
    ]) {
      expect(requestAllowed(hop, facts), hop).toBe(false);
    }
  });
});

describe('browser partitions', () => {
  it('keeps sign-ins per project and never names the app session', () => {
    const kept = partitionFor({ chatId: CHAT, projectId: PROJECT, keepSignIns: true });
    expect(kept).toBe(`persist:spark-browser-${PROJECT}`);
    expect(kept).toBe(projectPartition(PROJECT));
    expect(isBrowserPartition(kept)).toBe(true);
    expect(isBrowserPartition('')).toBe(false);
    expect(isBrowserPartition('persist:main')).toBe(false);
  });

  it('uses an in-memory partition per chat without a project or with sign-ins off', () => {
    const none = partitionFor({ chatId: CHAT, projectId: null, keepSignIns: true });
    const off = partitionFor({ chatId: CHAT, projectId: PROJECT, keepSignIns: false });
    expect(none).toBe(`spark-browser-chat-${CHAT}`);
    expect(off).toBe(none);
    expect(none.startsWith('persist:')).toBe(false);
  });

  it('refuses ids that are not ids', () => {
    expect(() => partitionFor({ chatId: '', projectId: null, keepSignIns: true })).toThrow();
    expect(() => projectPartition('../default')).toThrow();
  });
});
