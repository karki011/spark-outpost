import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { FAKE_TAILSCALE_HOST } from '../../apps/server/test/fake-tailscale.ts';
import { API_PORT } from './stub-config.ts';

export const ELSEWHERE = 'https://elsewhere.example';

export interface PhoneNetwork {
  browser: Browser;
  close(): Promise<void>;
}

function selfSigned(): { key: Buffer; cert: Buffer } {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'spark-phone-tls-'));
  try {
    const key = path.join(folder, 'key.pem');
    const cert = path.join(folder, 'cert.pem');
    execFileSync(
      'openssl',
      [
        ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1'],
        ...['-keyout', key, '-out', cert, '-subj', `/CN=${FAKE_TAILSCALE_HOST}`],
        ...['-addext', `subjectAltName=DNS:${FAKE_TAILSCALE_HOST}`],
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export async function startPhoneNetwork(): Promise<PhoneNetwork> {
  const server = https.createServer(selfSigned(), (incoming, outgoing) => {
    const forwarded = http.request(
      {
        host: '127.0.0.1',
        port: API_PORT,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    forwarded.on('error', () => outgoing.destroy());
    outgoing.on('close', () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${FAKE_TAILSCALE_HOST} 127.0.0.1:${port}`],
  });
  return {
    browser,
    async close() {
      await browser.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function newPhone(network: PhoneNetwork): Promise<BrowserContext> {
  const context = await network.browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  await context.route(`${ELSEWHERE}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Elsewhere</title>' }),
  );
  return context;
}

export interface Arrival {
  page: Page;
  documents: string[];
  cookieSent: boolean[];
}

export async function arriveFromElsewhere(context: BrowserContext, url: string): Promise<Arrival> {
  const page = await context.newPage();
  const documents: string[] = [];
  const cookieSent: boolean[] = [];
  page.on('request', (request) => {
    if (!request.isNavigationRequest() || request.url().startsWith(ELSEWHERE)) return;
    documents.push(new URL(request.url()).search);
    void request.allHeaders().then((headers) => cookieSent.push('cookie' in headers));
  });
  await page.goto(`${ELSEWHERE}/`);
  await page.evaluate((href) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = 'Open Spark';
    document.body.append(link);
  }, url);
  await page.getByRole('link', { name: 'Open Spark' }).click();
  await expect(page).not.toHaveURL(/elsewhere|spark_entry/);
  await page.waitForLoadState('load');
  return { page, documents, cookieSent };
}

export async function signedInAs(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const response = await fetch('/api/remote/session');
    if (!response.ok) return null;
    const session = (await response.json()) as { device: { name: string } | null };
    return session.device?.name ?? null;
  });
}
