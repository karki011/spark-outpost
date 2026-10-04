import { session, type Session } from 'electron';
import type { SignedInSite } from '@spark-outpost/contracts';
import {
  isBrowserPartition,
  projectPartition,
  requestAllowed,
  withoutSparkToken,
} from './request-guard.ts';

export interface SessionGuards {
  blockedPorts(): ReadonlySet<number>;
  roots(partition: string): readonly string[];
  log(line: string): void;
}

const configured = new WeakSet<Session>();

export function browserSession(partition: string, guards: SessionGuards): Session {
  if (!isBrowserPartition(partition)) throw new Error('Not a browser partition.');
  const target = session.fromPartition(partition);
  if (target === session.defaultSession) {
    throw new Error('The browser pane never uses the app session.');
  }
  if (configured.has(target)) return target;
  configured.add(target);
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => {
    const allowed = requestAllowed(details.url, {
      blockedPorts: guards.blockedPorts(),
      roots: guards.roots(partition),
    });
    if (!allowed)
      guards.log('Blocked a page request to a Spark port or a file outside the project.');
    callback({ cancel: !allowed });
  });
  target.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: withoutSparkToken(details.requestHeaders) });
  });
  target.on('will-download', (event) => event.preventDefault());
  return target;
}

function cookieOrigin(domain: string, secure: boolean): string {
  const host = domain.replace(/^\./, '');
  return `${secure ? 'https' : 'http'}://${host}`;
}

export async function signedInSites(projectId: string): Promise<SignedInSite[]> {
  const target = session.fromPartition(projectPartition(projectId));
  const cookies = await target.cookies.get({});
  const counts = new Map<string, number>();
  for (const cookie of cookies) {
    const origin = cookieOrigin(cookie.domain ?? '', cookie.secure ?? false);
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return [...counts]
    .map(([origin, count]) => ({ origin, cookies: count }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

export async function signOut(projectId: string, origin: string | null): Promise<void> {
  const target = session.fromPartition(projectPartition(projectId));
  if (origin === null) {
    await target.clearStorageData();
    return;
  }
  const host = new URL(origin).hostname;
  const cookies = await target.cookies.get({});
  for (const cookie of cookies) {
    const domain = (cookie.domain ?? '').replace(/^\./, '');
    if (domain !== host) continue;
    const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path ?? '/'}`;
    await target.cookies.remove(url, cookie.name);
  }
  for (const scheme of ['http', 'https']) {
    await target.clearStorageData({ origin: `${scheme}://${new URL(origin).host}` });
  }
}
