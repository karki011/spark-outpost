import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import {
  FAKE_TAILSCALE_HOST,
  type FakeTailscaleState,
} from '../../apps/server/test/fake-tailscale.ts';
import { matchApiClock } from './api-clock.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { API_PORT, FAKE_TAILSCALE_STATE } from './stub-config.ts';

export const PHONE_ADDRESS = `https://${FAKE_TAILSCALE_HOST}`;
export const PHONE_PAGE = 'http://phone.test';
export const WIDE = { width: 1280, height: 900 };
export const NARROW = { width: 390, height: 844 };
export const REMOTE_TURN_MS = 20_000;
const PUBLIC = path.resolve(import.meta.dirname, '../../apps/web/public');
const PUBLIC_FILES: Record<string, string> = {
  '/theme.css': 'text/css',
  '/theme-base.css': 'text/css',
  '/theme-bold.css': 'text/css',
  '/appearance.js': 'text/javascript',
};

export function setFakeTailscale(change: Partial<FakeTailscaleState> | null): void {
  if (change) writeFileSync(FAKE_TAILSCALE_STATE, JSON.stringify(change));
  else rmSync(FAKE_TAILSCALE_STATE, { force: true });
}

export async function resetPhone(): Promise<void> {
  setFakeTailscale(null);
  await resetTestDatabase({ onboarded: true });
  const db = openTestDb();
  try {
    await db.query(
      `TRUNCATE remote_audit, remote_device_sessions, remote_passkeys, remote_push_subscriptions,
         remote_devices,
         remote_access_settings`,
    );
  } finally {
    await db.end();
  }
}

interface PhoneResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function asPhone(method: string, url: string, body?: string): Promise<PhoneResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: API_PORT,
        method,
        path: url,
        headers: {
          Host: FAKE_TAILSCALE_HOST,
          ...(body === undefined
            ? {}
            : { Origin: PHONE_ADDRESS, 'Content-Type': 'application/json' }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const name of ['content-type', 'content-security-policy', 'cache-control']) {
            const value = response.headers[name];
            if (typeof value === 'string') headers[name] = value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

export async function pairFromPhone(code: string, deviceName: string): Promise<string> {
  const response = await asPhone('POST', '/api/remote/pair', JSON.stringify({ code, deviceName }));
  return (JSON.parse(response.body) as { matchCode: string }).matchCode;
}

export async function servePhonePage(page: Page): Promise<void> {
  await page.route(`${PHONE_PAGE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const publicType = PUBLIC_FILES[url.pathname];
    if (publicType) {
      const body = readFileSync(path.join(PUBLIC, url.pathname), 'utf8');
      await route.fulfill({ contentType: publicType, body });
      return;
    }
    const sent = request.method() === 'GET' ? undefined : (request.postData() ?? '{}');
    const response = await asPhone(request.method(), url.pathname + url.search, sent);
    await route.fulfill(response);
  });
}

export async function denyWaitingPhones(page: Page): Promise<void> {
  const listed = await page.request.get('/api/remote/pairings');
  const { pairings } = (await listed.json()) as { pairings: { id: string }[] };
  for (const pairing of pairings) {
    await page.request.post(`/api/remote/pairings/${pairing.id}/deny`, { data: {} });
  }
}

export async function openPhone(page: Page) {
  await matchApiClock(page);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Remote control' })
    .click();
  await expect(page.getByRole('heading', { name: 'Remote control', level: 1 })).toBeVisible();
  return page.getByRole('main');
}

export async function turnOn(page: Page) {
  await page.getByRole('switch', { name: 'Remote control' }).click();
  await expect(page.getByRole('heading', { name: 'Remote control is on' })).toBeVisible({
    timeout: REMOTE_TURN_MS,
  });
}

export async function startPairing(
  page: Page,
  button: string | RegExp = 'Pair a device',
): Promise<string> {
  const code = page.locator('.ph-code-text');
  await page.getByRole('button', { name: button }).click();
  await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  return (await code.textContent()) ?? '';
}

export async function openPairingPage(
  browser: Browser,
  hash = '',
  theme: string | null = 'system',
) {
  const context = await browser.newContext({ viewport: NARROW });
  const phone = await context.newPage();
  if (theme) {
    await phone.addInitScript((saved) => localStorage.setItem('spark-outpost.theme', saved), theme);
  }
  await servePhonePage(phone);
  await phone.goto(`${PHONE_PAGE}/${hash}`);
  return { context, phone };
}
