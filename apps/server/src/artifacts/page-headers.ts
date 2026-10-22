import type { ServerResponse } from 'node:http';
import { ARTIFACT_PAGE_POLICY } from '@spark-outpost/contracts';

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

export function artifactPagePolicy(frameAncestors: readonly string[]): string {
  const ancestors = frameAncestors.length > 0 ? frameAncestors.join(' ') : "'none'";
  return `${ARTIFACT_PAGE_POLICY}; frame-ancestors ${ancestors}`;
}

export function sendArtifactPage(
  res: Pick<ServerResponse, 'writeHead' | 'end'>,
  html: string,
  frameAncestors: readonly string[],
): void {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(body.length),
    'Content-Security-Policy': artifactPagePolicy(frameAncestors),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
