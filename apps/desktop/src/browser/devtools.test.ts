import { describe, expect, it } from 'vitest';
import type { Cdp } from './cdp.ts';
import { EVAL_TOO_SLOW, evaluateInPage, maskValues } from './devtools-eval.ts';
import { summarisePerformance } from './devtools-page.ts';
import { isDevtoolsShortcut } from './selection-menu.ts';
import { devtoolsRequestAllowed } from './sessions.ts';

const PASSWORD = 'hunter2-Pass';
const FILLED = 'vault-user@example.test';
const PAGE = 'https://shop.example.com/cart';

function page(answers: Record<string, (params: Record<string, unknown>) => unknown>): Cdp & {
  sent: string[];
} {
  const sent: string[] = [];
  return {
    sent,
    send: (method, params = {}) => {
      sent.push(method);
      const answer = answers[method];
      return answer ? Promise.resolve(answer(params) as never) : Promise.resolve({} as never);
    },
    listen: () => () => undefined,
    detach: () => undefined,
  };
}

const document = {
  root: {
    backendNodeId: 1,
    nodeName: '#document',
    children: [
      { backendNodeId: 5, nodeName: 'INPUT', attributes: ['type', 'password'] },
      { backendNodeId: 6, nodeName: 'INPUT', attributes: ['type', 'email'] },
    ],
  },
};

function pageReturning(result: unknown, fieldValues: Record<number, string> = {}) {
  let resolving = 0;
  return page({
    'Runtime.evaluate': (params) => (params.contextId ? { result: {} } : result),
    'DOM.getDocument': () => document,
    'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main' } } }),
    'Page.createIsolatedWorld': () => ({ executionContextId: 77 }),
    'DOM.resolveNode': (params) => {
      resolving = Number(params.backendNodeId);
      return { object: { objectId: `node-${resolving}` } };
    },
    'Runtime.callFunctionOn': (params) => ({
      result: { value: fieldValues[Number(String(params.objectId).slice(5))] ?? '' },
    }),
  });
}

describe('running an expression in the page', () => {
  it('returns the value as JSON and masks what the protected fields hold', async () => {
    const cdp = pageReturning(
      {
        result: {
          type: 'object',
          value: { rows: 3, typed: PASSWORD, user: FILLED, note: encodeURIComponent(FILLED) },
        },
      },
      { 5: PASSWORD, 6: FILLED },
    );
    const outcome = await evaluateInPage(cdp, 'window.state', new Set([6]), PAGE);
    expect(outcome.type).toBe('object');
    expect(outcome.value).not.toContain(PASSWORD);
    expect(outcome.value).not.toContain(FILLED);
    expect(JSON.parse(outcome.value)).toEqual({
      rows: 3,
      typed: '[masked]',
      user: '[masked]',
      note: '[masked]',
    });
    expect(outcome.masked).toBe(3);
    expect(cdp.sent).toContain('Page.createIsolatedWorld');
  });

  it('masks a value the script read and then cleared from its field', async () => {
    let cleared = false;
    const cdp = page({
      'Runtime.evaluate': (params) => {
        if (params.contextId) return { result: {} };
        cleared = true;
        return { result: { type: 'string', value: PASSWORD } };
      },
      'DOM.getDocument': () => document,
      'Page.getFrameTree': () => ({ frameTree: { frame: { id: 'main' } } }),
      'Page.createIsolatedWorld': () => ({ executionContextId: 77 }),
      'DOM.resolveNode': (params) => ({
        object: { objectId: `node-${String(params.backendNodeId)}` },
      }),
      'Runtime.callFunctionOn': (params) => ({
        result: { value: !cleared && params.objectId === 'node-5' ? PASSWORD : '' },
      }),
    });
    const outcome = await evaluateInPage(cdp, 'takeAndClear()', new Set(), PAGE);
    expect(outcome.value).not.toContain(PASSWORD);
    expect(outcome.masked).toBe(1);
  });

  it('reports a thrown error with its stack, masked too', async () => {
    const cdp = pageReturning(
      {
        exceptionDetails: {
          text: 'Uncaught',
          exception: { description: `Error: bad token ${PASSWORD}\n    at <anonymous>:1:7` },
        },
      },
      { 5: PASSWORD },
    );
    const outcome = await evaluateInPage(cdp, 'boom()', new Set(), PAGE);
    expect(outcome).toMatchObject({ type: 'exception', value: 'undefined' });
    expect(outcome.exception).toBe('Error: bad token [masked]\n    at <anonymous>:1:7');
  });

  it('caps a large result and keeps undefined and special numbers readable', async () => {
    const big = await evaluateInPage(
      pageReturning({ result: { type: 'string', value: 'x'.repeat(20_000) } }),
      'big',
      new Set(),
      PAGE,
    );
    expect(big.truncated).toBe(true);
    expect(big.value.length).toBe(8000);
    const nothing = await evaluateInPage(
      pageReturning({ result: { type: 'undefined' } }),
      'x',
      new Set(),
      PAGE,
    );
    expect(nothing.value).toBe('undefined');
    const infinite = await evaluateInPage(
      pageReturning({ result: { type: 'number', unserializableValue: 'Infinity' } }),
      '1/0',
      new Set(),
      PAGE,
    );
    expect(infinite.value).toBe('Infinity');
  });

  it('stops waiting for a promise that never settles', async () => {
    const cdp = page({
      'Runtime.evaluate': () => new Promise(() => undefined),
      'DOM.getDocument': () => ({ root: { backendNodeId: 1, nodeName: '#document' } }),
    });
    await expect(evaluateInPage(cdp, 'new Promise(() => {})', new Set(), PAGE, 30)).rejects.toThrow(
      EVAL_TOO_SLOW,
    );
  });

  it('masks cookie values and auth-looking storage the shared sign-ins hold', async () => {
    const session = 'user-session-8f2k1m9q';
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZSJ9.c2lnbmF0dXJl';
    const cdp = page({
      'Runtime.evaluate': (params) =>
        params.contextId
          ? { result: {} }
          : {
              result: {
                type: 'string',
                value: `sid=${session}; lang=en | ${JSON.stringify({ accessToken: token })} | dark`,
              },
            },
      'DOM.getDocument': () => ({ root: { backendNodeId: 1, nodeName: '#document' } }),
      'Network.getCookies': () => ({
        cookies: [
          { name: 'sid', value: session },
          { name: 'lang', value: 'en' },
        ],
      }),
      'DOMStorage.getDOMStorageItems': (params) =>
        (params.storageId as { isLocalStorage: boolean }).isLocalStorage
          ? {
              entries: [
                ['sb-ref-auth-token', JSON.stringify({ accessToken: token })],
                ['theme', 'dark'],
              ],
            }
          : { entries: [] },
    });
    const outcome = await evaluateInPage(cdp, 'document.cookie', new Set(), PAGE);
    expect(outcome.value).not.toContain(session);
    expect(outcome.value).not.toContain(token);
    expect(outcome.value).toContain('lang=en');
    expect(outcome.value).toContain('dark');
  });

  it('never masks short values that would hide ordinary text', () => {
    expect(maskValues('a b ab', ['a', 'ab'])).toEqual({ text: 'a b ab', masked: 0 });
  });
});

describe('page performance', () => {
  it('counts resources by type and names the slowest without secret query values', () => {
    const summary = summarisePerformance({
      navigation: { ttfbMs: 120, loadMs: 900 },
      resources: [
        { url: 'https://cdn.example/app.js', type: 'script', ms: 300, bytes: 1000 },
        { url: 'https://api.example/costs?token=t1', type: 'fetch', ms: 1200, bytes: 50 },
        { url: 'https://cdn.example/font.woff2', type: 'css', ms: 40, bytes: null },
      ],
      vitals: {
        lcpMs: 820,
        cls: 0.02,
        inpMs: null,
        longTasks: 2,
        longTaskMs: 180,
        longestTaskMs: 120,
      },
    });
    expect(summary.resources).toEqual({
      count: 3,
      byType: { script: 1, fetch: 1, css: 1 },
      slowest: [
        { url: 'https://api.example/costs?token=[redacted]', type: 'fetch', ms: 1200, bytes: 50 },
        { url: 'https://cdn.example/app.js', type: 'script', ms: 300, bytes: 1000 },
        { url: 'https://cdn.example/font.woff2', type: 'css', ms: 40, bytes: null },
      ],
    });
  });
});

describe('the user’s developer tools', () => {
  it('opens on ⌥⌘I on a Mac and Ctrl+Alt+I elsewhere', () => {
    const key = { type: 'keyDown', code: 'KeyI', alt: true, shift: false };
    expect(isDevtoolsShortcut({ ...key, meta: true, control: false }, 'darwin')).toBe(true);
    expect(isDevtoolsShortcut({ ...key, meta: false, control: true }, 'linux')).toBe(true);
    expect(isDevtoolsShortcut({ ...key, meta: true, control: false, shift: true }, 'darwin')).toBe(
      false,
    );
  });

  it('never lets the developer tools window reach Spark’s ports', () => {
    const blocked = new Set([38203, 54320]);
    expect(devtoolsRequestAllowed('http://127.0.0.1:38203/api/health', blocked)).toBe(false);
    expect(devtoolsRequestAllowed('ws://localhost:54320/', blocked)).toBe(false);
    expect(devtoolsRequestAllowed('https://cdn.example/app.js.map', blocked)).toBe(true);
    expect(devtoolsRequestAllowed('devtools://devtools/bundled/devtools_app.html', blocked)).toBe(
      true,
    );
    expect(devtoolsRequestAllowed('not a url', blocked)).toBe(false);
  });
});
