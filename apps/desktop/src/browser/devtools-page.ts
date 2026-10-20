import {
  BROWSER_STORAGE_ITEMS_MAX,
  BROWSER_STORAGE_VALUE_MAX,
  redactQuery,
  secretStorageItem,
  storageSecretParts,
  STORAGE_SECRET_MIN,
  type BrowserCookieFacts,
  type BrowserPerformanceResult,
  type BrowserStorageItem,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { releaseWorld, runInWorld, sparkWorld } from './spark-world.ts';

type Performance = Pick<BrowserPerformanceResult, 'navigation' | 'resources' | 'vitals'>;

const READ_PERFORMANCE = `(async () => {
  const round = (value) => Math.round(value * 10) / 10;
  const nav = performance.getEntriesByType('navigation')[0];
  const navigation = nav ? {
    redirectMs: round(nav.redirectEnd - nav.redirectStart),
    dnsMs: round(nav.domainLookupEnd - nav.domainLookupStart),
    connectMs: round(nav.connectEnd - nav.connectStart),
    ttfbMs: round(nav.responseStart - nav.startTime),
    responseMs: round(nav.responseEnd - nav.responseStart),
    domInteractiveMs: round(nav.domInteractive),
    domContentLoadedMs: round(nav.domContentLoadedEventEnd),
    loadMs: round(nav.loadEventEnd),
    transferBytes: nav.transferSize,
  } : null;
  const resources = performance.getEntriesByType('resource').map((entry) => ({
    url: entry.name, type: entry.initiatorType, ms: round(entry.duration), bytes: entry.transferSize ?? null,
  }));
  const buffered = (type) => new Promise((resolve) => {
    try {
      const seen = [];
      const observer = new PerformanceObserver((list) => seen.push(...list.getEntries()));
      observer.observe({ type, buffered: true });
      setTimeout(() => { observer.disconnect(); resolve(seen); }, 150);
    } catch { resolve(null); }
  });
  const [lcp, shifts, events, tasks] = await Promise.all([
    buffered('largest-contentful-paint'), buffered('layout-shift'), buffered('event'), buffered('longtask'),
  ]);
  return {
    navigation,
    resources,
    vitals: {
      lcpMs: lcp && lcp.length ? round(lcp[lcp.length - 1].startTime) : null,
      cls: shifts ? round(shifts.filter((s) => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0) * 1000) / 1000 : null,
      inpMs: events && events.length ? Math.max(...events.map((e) => e.duration)) : null,
      longTasks: tasks ? tasks.length : null,
      longTaskMs: tasks ? round(tasks.reduce((sum, t) => sum + t.duration, 0)) : null,
      longestTaskMs: tasks && tasks.length ? round(Math.max(...tasks.map((t) => t.duration))) : null,
    },
  };
})()`;

interface RawPerformance {
  navigation: Record<string, number> | null;
  resources: { url: string; type: string; ms: number; bytes: number | null }[];
  vitals: Performance['vitals'];
}

export function summarisePerformance(raw: RawPerformance): Performance {
  const byType: Record<string, number> = {};
  for (const resource of raw.resources) byType[resource.type] = (byType[resource.type] ?? 0) + 1;
  const slowest = [...raw.resources]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((resource) => ({ ...resource, url: redactQuery(resource.url).slice(0, 4096) }));
  return {
    navigation: raw.navigation,
    resources: { count: raw.resources.length, byType, slowest },
    vitals: raw.vitals,
  };
}

export async function pagePerformance(cdp: Cdp): Promise<Performance> {
  const world = await sparkWorld(cdp);
  const raw = await runInWorld<RawPerformance>(cdp, world, READ_PERFORMANCE);
  await releaseWorld(cdp);
  if (!raw) throw new Error('The page did not report its performance.');
  return summarisePerformance(raw);
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function clip(text: string): string {
  return text.length <= BROWSER_STORAGE_VALUE_MAX
    ? text
    : `${text.slice(0, BROWSER_STORAGE_VALUE_MAX - 1)}…`;
}

function shownItem(key: string, value: string, values: boolean): BrowserStorageItem {
  const item = { key: key.slice(0, 300), bytes: bytes(key) + bytes(value) };
  if (!values) return item;
  return secretStorageItem(key, value)
    ? { ...item, masked: true }
    : { ...item, value: clip(value) };
}

async function domEntries(
  cdp: Cdp,
  origin: string,
  isLocalStorage: boolean,
): Promise<[string, string][]> {
  const found = await cdp
    .send<{ entries: [string, string][] }>('DOMStorage.getDOMStorageItems', {
      storageId: { securityOrigin: origin, isLocalStorage },
    })
    .catch(() => ({ entries: [] as [string, string][] }));
  return found.entries ?? [];
}

async function domStorage(
  cdp: Cdp,
  origin: string,
  isLocalStorage: boolean,
  values: boolean,
): Promise<BrowserStorageItem[]> {
  const entries = await domEntries(cdp, origin, isLocalStorage);
  return entries
    .slice(0, BROWSER_STORAGE_ITEMS_MAX)
    .map(([key, value]) => shownItem(key, value, values));
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  session: boolean;
  expires: number;
}

async function pageCookies(cdp: Cdp, url: string): Promise<CdpCookie[]> {
  const found = await cdp
    .send<{ cookies: CdpCookie[] }>('Network.getCookies', { urls: [url] })
    .catch(() => ({ cookies: [] as CdpCookie[] }));
  return found.cookies ?? [];
}

async function cookies(cdp: Cdp, url: string): Promise<BrowserCookieFacts[]> {
  const found = await pageCookies(cdp, url);
  return found.slice(0, BROWSER_STORAGE_ITEMS_MAX).map((cookie) => ({
    name: cookie.name.slice(0, 300),
    domain: cookie.domain.slice(0, 300),
    path: cookie.path.slice(0, 500),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite ?? null,
    expires: cookie.session ? null : new Date(cookie.expires * 1000).toISOString(),
    bytes: bytes(cookie.name) + bytes(cookie.value),
  }));
}

export async function pageStorage(cdp: Cdp, url: string, origin: string, values: boolean) {
  await cdp.send('DOMStorage.enable').catch(() => undefined);
  return {
    local: await domStorage(cdp, origin, true, values),
    session: await domStorage(cdp, origin, false, values),
    cookies: await cookies(cdp, url),
  };
}

export async function storageSecrets(cdp: Cdp, url: string, origin: string): Promise<string[]> {
  await cdp.send('DOMStorage.enable').catch(() => undefined);
  const cookieValues = (await pageCookies(cdp, url))
    .map((cookie) => cookie.value)
    .filter((value) => value.length >= STORAGE_SECRET_MIN);
  const entries = [
    ...(await domEntries(cdp, origin, true)),
    ...(await domEntries(cdp, origin, false)),
  ];
  const itemParts = entries
    .filter(([key, value]) => secretStorageItem(key, value))
    .flatMap(([, value]) => storageSecretParts(value));
  return [...cookieValues, ...itemParts];
}
