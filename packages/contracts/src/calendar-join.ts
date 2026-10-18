import { z } from 'zod';

export const calendarServiceSchema = z.enum(['zoom', 'meet', 'teams', 'webex']);
export type CalendarService = z.infer<typeof calendarServiceSchema>;

export const CALENDAR_SERVICE_NAMES: Record<CalendarService, string> = {
  zoom: 'Zoom',
  meet: 'Google Meet',
  teams: 'Microsoft Teams',
  webex: 'Webex',
};

export const joinLinkSchema = z.object({
  url: z.url().max(2_000),
  host: z.string().max(300),
  service: calendarServiceSchema,
  unwrappedFrom: z.literal('Outlook SafeLinks').nullable(),
});
export type JoinLink = z.infer<typeof joinLinkSchema>;

export interface JoinSources {
  url: string | null;
  location: string | null;
  noteLinks: readonly string[];
}

interface ServiceRule {
  service: CalendarService;
  hosts: readonly string[];
  suffixes: readonly string[];
  path: (pathname: string) => boolean;
}

const startsWithAny = (prefixes: readonly string[]) => (pathname: string) =>
  prefixes.some((prefix) => pathname.startsWith(prefix));

const WEBEX_JPHP = /^\/([a-z0-9-]+\/)?j\.php$/i;
const MEET_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/;

const RULES: readonly ServiceRule[] = [
  {
    service: 'zoom',
    hosts: ['zoom.us', 'zoomgov.com'],
    suffixes: ['.zoom.us', '.zoomgov.com'],
    path: startsWithAny(['/j/', '/my/', '/w/', '/s/']),
  },
  {
    service: 'meet',
    hosts: ['meet.google.com'],
    suffixes: [],
    path: (pathname) => MEET_CODE.test(pathname),
  },
  {
    service: 'teams',
    hosts: ['teams.microsoft.com', 'teams.live.com'],
    suffixes: [],
    path: startsWithAny(['/l/meetup-join/', '/meet/']),
  },
  {
    service: 'webex',
    hosts: [],
    suffixes: ['.webex.com'],
    path: (pathname) =>
      startsWithAny(['/meet/', '/join/', '/wbxmjs/joinservice/'])(pathname) ||
      WEBEX_JPHP.test(pathname),
  },
];

interface JoinUrl {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  username: string;
  password: string;
  searchParams: { get(name: string): string | null };
  toString(): string;
}

const UrlParser = (globalThis as unknown as { URL: new (value: string) => JoinUrl }).URL;

const SAFELINKS_SUFFIX = '.safelinks.protection.outlook.com';
const URL_IN_TEXT = /https:\/\/[^\s<>"')\]]+/g;

function strictHttps(raw: string): JoinUrl | null {
  let url: JoinUrl;
  try {
    url = new UrlParser(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '') return null;
  return url;
}

function hostMatches(hostname: string, rule: ServiceRule): boolean {
  const host = hostname.toLowerCase();
  if (rule.hosts.includes(host)) return true;
  return rule.suffixes.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

function serviceOf(url: JoinUrl): CalendarService | null {
  const rule = RULES.find((candidate) => hostMatches(url.hostname, candidate));
  if (!rule || !rule.path(url.pathname)) return null;
  return rule.service;
}

function isSafeLinks(url: JoinUrl): boolean {
  const host = url.hostname.toLowerCase();
  return host.endsWith(SAFELINKS_SUFFIX) && host.length > SAFELINKS_SUFFIX.length;
}

function joinFromUrl(raw: string): JoinLink | null {
  const url = strictHttps(raw);
  if (!url) return null;
  if (isSafeLinks(url)) {
    const inner = strictHttps(url.searchParams.get('url') ?? '');
    if (!inner || serviceOf(inner) !== 'teams') return null;
    return {
      url: inner.toString(),
      host: inner.hostname.toLowerCase(),
      service: 'teams',
      unwrappedFrom: 'Outlook SafeLinks',
    };
  }
  const service = serviceOf(url);
  if (!service) return null;
  return { url: url.toString(), host: url.hostname.toLowerCase(), service, unwrappedFrom: null };
}

function linksIn(text: string | null): string[] {
  return text ? [...text.matchAll(URL_IN_TEXT)].map((match) => match[0]) : [];
}

export function joinLink(sources: JoinSources): JoinLink | null {
  const candidates = [
    ...(sources.url ? [sources.url] : []),
    ...linksIn(sources.location),
    ...sources.noteLinks,
  ];
  for (const candidate of candidates) {
    const link = joinFromUrl(candidate);
    if (link) return link;
  }
  return null;
}

export const JOIN_LEAD_MS = 10 * 60_000;

export function joinOpen(event: { start: number; end: number }, now: number): boolean {
  return now >= event.start - JOIN_LEAD_MS && now < event.end;
}
