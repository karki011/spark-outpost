import { runInNewContext } from 'node:vm';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { REMOTE_DEVICE_NAME_MAX } from '@spark-outpost/contracts';
import { sendPairingPage } from './pairing-page.ts';

type Listener = (event: { preventDefault(): void }) => unknown;

function fakeElement() {
  const listeners = new Map<string, Listener>();
  const button = { disabled: false, focus: () => undefined };
  return {
    value: '',
    hidden: false,
    textContent: '',
    dataset: {} as Record<string, string>,
    selectionStart: 0,
    listeners,
    focus: () => undefined,
    select: () => undefined,
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    toggleAttribute: () => undefined,
    querySelector: () => button,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
}

function served(): { html: string; headers: Record<string, string> } {
  const sent = { html: '', headers: {} as Record<string, string> };
  const res = {
    status: () => res,
    set: (headers: Record<string, string>) => {
      sent.headers = headers;
      return res;
    },
    send: (html: string) => {
      sent.html = html;
      return res;
    },
  };
  sendPairingPage(res as unknown as Response, { passkeys: false });
  return sent;
}

function pageScript(): string {
  const scripts = [...served().html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
  return scripts.at(-1)![1]!;
}

async function openedWith(hash: string) {
  const elements = new Map<string, ReturnType<typeof fakeElement>>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id)!;
  };
  const posted: { path: string; body: Record<string, unknown> }[] = [];
  const replaced: string[] = [];
  const context = {
    URLSearchParams,
    document: {
      hidden: false,
      querySelector: () => element('main'),
      getElementById: element,
      addEventListener: () => undefined,
    },
    location: { hash, search: '', pathname: '/', replace: () => undefined },
    history: { replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) },
    window: {},
    navigator: {},
    setTimeout: () => 0,
    fetch: async (path: string, init: { body: string }) => {
      posted.push({ path, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: false, json: async () => ({ error: 'Stopped by the test.' }) };
    },
  };
  runInNewContext(pageScript(), context);
  const submit = async () => {
    await element('pair').listeners.get('submit')!({ preventDefault: () => undefined });
    return posted.at(-1)!;
  };
  return { code: element('code'), name: element('name'), replaced, submit };
}

describe('pairing page link', () => {
  it('fills the code and the device name and says it is a Spark', async () => {
    const page = await openedWith('#code=ABCD-EFGH-JKLM&name=Studio+Mac&kind=spark');

    expect(page.code.value).toBe('ABCD-EFGH-JKLM');
    expect(page.name.value).toBe('Studio Mac');
    expect(page.replaced).toEqual(['/']);
    expect(await page.submit()).toEqual({
      path: '/api/remote/pair',
      body: { code: 'ABCD-EFGH-JKLM', deviceName: 'Studio Mac', kind: 'spark' },
    });
  });

  it('sends no kind for a plain pairing link', async () => {
    const page = await openedWith('#code=ABCD-EFGH-JKLM');

    expect(page.name.value).toBe('');
    expect((await page.submit()).body).toEqual({ code: 'ABCD-EFGH-JKLM', deviceName: '' });
  });

  it('ignores a kind that is not exactly spark', async () => {
    for (const kind of ['Spark', 'spark ', 'browser', 'admin', '']) {
      const page = await openedWith(`#code=ABCD-EFGH-JKLM&kind=${encodeURIComponent(kind)}`);
      expect([kind, 'kind' in (await page.submit()).body]).toEqual([kind, false]);
    }
  });

  it('cuts a long name from the link to the device name limit', async () => {
    const long = 'M'.repeat(REMOTE_DEVICE_NAME_MAX + 40);
    const page = await openedWith(`#name=${long}&kind=spark`);

    expect(page.name.value).toBe('M'.repeat(REMOTE_DEVICE_NAME_MAX));
    expect(page.code.value).toBe('');
  });

  it('puts a name from the link in the field as text, never in the page markup', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    const page = await openedWith(`#name=${encodeURIComponent(markup)}`);

    expect(page.name.value).toBe(markup);
    expect(served().html).not.toContain(markup);
    expect(pageScript()).not.toContain('innerHTML');
  });

  it('keeps the page locked to its own nonce', () => {
    const { html, headers } = served();
    const nonce = /script-src 'nonce-([^']+)'/.exec(headers['Content-Security-Policy']!)![1]!;

    expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(html.match(/<script /g)).toHaveLength(3);
    expect(
      html.match(new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}"`, 'g')),
    ).toHaveLength(3);
  });
});
