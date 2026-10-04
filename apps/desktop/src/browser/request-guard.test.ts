import { describe, expect, it } from 'vitest';
import {
  insideRoots,
  isBrowserPartition,
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
