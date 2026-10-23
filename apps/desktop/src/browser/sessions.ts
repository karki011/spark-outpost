import { session, type Session, type WebContents } from 'electron';
import type { BrowserProfile, SignedInSite } from '@spark-outpost/contracts';
import { MEDIA_GUARD_ID, mediaGuardPreload } from '../media-guard.ts';
import {
  COPY_GUARD_ID,
  copyGuardPreload,
  pagePermissionAllowed,
  type InputMarks,
} from './clipboard-permission.ts';
import {
  BROWSER_PARTITION,
  PERSONAL_PARTITION,
  requestAllowed,
  withoutSparkToken,
} from './request-guard.ts';

export interface SessionGuards {
  blockedPorts(): ReadonlySet<number>;
  roots(contents: WebContents | null): readonly string[];
  log(line: string): void;
  inputMarks(contents: WebContents | null): InputMarks | null;
}

const configured = new WeakSet<Session>();

export function profilePartition(profile: BrowserProfile): string {
  return profile === 'personal' ? PERSONAL_PARTITION : BROWSER_PARTITION;
}

export function browserSession(partition: string, guards: SessionGuards): Session {
  const target = session.fromPartition(partition);
  if (target === session.defaultSession) {
    throw new Error('The browser pane never uses the app session.');
  }
  if (configured.has(target)) return target;
  configured.add(target);
  target.setPermissionRequestHandler((contents, permission, callback) =>
    callback(pagePermissionAllowed(permission, guards.inputMarks(contents), Date.now())),
  );
  target.setPermissionCheckHandler((contents, permission) =>
    pagePermissionAllowed(permission, guards.inputMarks(contents), Date.now()),
  );
  target.registerPreloadScript({
    type: 'frame',
    filePath: mediaGuardPreload(),
    id: MEDIA_GUARD_ID,
  });
  target.registerPreloadScript({ type: 'frame', filePath: copyGuardPreload(), id: COPY_GUARD_ID });
  target.setDevicePermissionHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => {
    const allowed = requestAllowed(details.url, {
      blockedPorts: guards.blockedPorts(),
      roots: guards.roots(details.webContents ?? null),
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

export const DEVTOOLS_PARTITION = 'spark-browser-devtools';
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

export function devtoolsRequestAllowed(value: string, blockedPorts: ReadonlySet<number>): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!NETWORK_SCHEMES.has(url.protocol)) return true;
  const port = Number(
    url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80),
  );
  return !blockedPorts.has(port);
}

export function devtoolsSession(guards: Pick<SessionGuards, 'blockedPorts' | 'log'>): Session {
  const target = session.fromPartition(DEVTOOLS_PARTITION);
  if (target === session.defaultSession) {
    throw new Error('Developer tools never use the app session.');
  }
  if (configured.has(target)) return target;
  configured.add(target);
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => {
    const allowed = devtoolsRequestAllowed(details.url, guards.blockedPorts());
    if (!allowed) guards.log('Blocked a developer tools request to a Spark port.');
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

export async function signedInSites(): Promise<SignedInSite[]> {
  const target = session.fromPartition(BROWSER_PARTITION);
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

export async function signOut(origin: string | null): Promise<void> {
  const target = session.fromPartition(BROWSER_PARTITION);
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
