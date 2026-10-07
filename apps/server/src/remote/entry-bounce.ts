import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { REMOTE_ENTRY_PARAM } from '@spark-outpost/contracts';

const SAFE_PATH = /^\/(?![/\\])/;

function fetchHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

export function isEntryReturn(req: Request): boolean {
  return req.method === 'GET' && req.query[REMOTE_ENTRY_PARAM] !== undefined;
}

export function mayHaveLostCookie(req: Request): boolean {
  if (req.method !== 'GET' || isEntryReturn(req)) return false;
  if (fetchHeader(req, 'sec-fetch-site') === 'same-origin') return false;
  const destination = fetchHeader(req, 'sec-fetch-dest');
  return destination === undefined || destination === 'document';
}

export function entryTarget(req: Request): string {
  const path = SAFE_PATH.test(req.path) ? req.path : '/';
  const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
  query.delete(REMOTE_ENTRY_PARAM);
  const rest = query.toString();
  return rest ? `${path}?${rest}` : path;
}

const SCRIPT = `
  const next = new URL(location.href);
  next.searchParams.set('${REMOTE_ENTRY_PARAM}', '1');
  location.replace(next);
`;

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Spark Outpost</title>
<noscript><meta http-equiv="refresh" content="0;url=?${REMOTE_ENTRY_PARAM}=1"></noscript>
</head>
<body>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

export function sendEntryBounce(res: Response): void {
  const nonce = randomBytes(16).toString('base64');
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    })
    .send(page(nonce));
}
