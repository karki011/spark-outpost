import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  FAKE_TAILSCALE_HOST,
  type FakeTailscaleState,
} from '../../apps/server/test/fake-tailscale.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { API_PORT, FAKE_TAILSCALE_STATE } from './stub-config.ts';

export const PHONE_ADDRESS = `https://${FAKE_TAILSCALE_HOST}`;
export const PHONE_PAGE = 'http://phone.test';
const THEME = path.resolve(import.meta.dirname, '../../apps/web/public/theme.css');

export function setFakeTailscale(change: Partial<FakeTailscaleState> | null): void {
  if (change) writeFileSync(FAKE_TAILSCALE_STATE, JSON.stringify(change));
  else rmSync(FAKE_TAILSCALE_STATE, { force: true });
}

export async function resetPhone(): Promise<void> {
  setFakeTailscale(null);
  await resetTestDatabase({ onboarded: true });
  const db = openTestDb();
  try {
    await db.query('TRUNCATE remote_audit, remote_devices, remote_access_settings');
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
    if (url.pathname === '/theme.css') {
      await route.fulfill({ contentType: 'text/css', body: readFileSync(THEME, 'utf8') });
      return;
    }
    const sent = request.method() === 'GET' ? undefined : (request.postData() ?? '{}');
    const response = await asPhone(request.method(), url.pathname, sent);
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
