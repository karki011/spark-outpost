const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'display-capture=()',
  'clipboard-read=()',
  'clipboard-write=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'bluetooth=()',
  'payment=()',
  'publickey-credentials-get=()',
].join(', ');

export const PAGE_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "frame-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CONTENT_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  'sandbox allow-scripts',
  "frame-ancestors 'self'",
].join('; ');

const API_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

function securityHeaders(policy: string, extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-security-policy': policy,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'cache-control': 'no-store',
    'permissions-policy': PERMISSIONS_POLICY,
    ...extra,
  });
}

export function pageResponse(status: number, html: string, extra: Record<string, string> = {}) {
  const headers = securityHeaders(PAGE_POLICY, {
    'content-type': 'text/html; charset=utf-8',
    'cross-origin-opener-policy': 'same-origin',
    ...extra,
  });
  return new Response(html, { status, headers });
}

export function contentResponse(html: string): Response {
  const headers = securityHeaders(CONTENT_POLICY, {
    'content-type': 'text/html; charset=utf-8',
  });
  return new Response(html, { status: 200, headers });
}

export function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}) {
  const headers = securityHeaders(API_POLICY, {
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonError(status: number, error: string, extra: Record<string, string> = {}) {
  return jsonResponse(status, { error }, extra);
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: securityHeaders(API_POLICY) });
}
