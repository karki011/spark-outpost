import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 30_000;
export const GRAPH_PAGE_SIZE = 100;
export const GRAPH_MAX_PAGES = 50;
const PREFER = `outlook.timezone="UTC", odata.maxpagesize=${GRAPH_PAGE_SIZE}`;
const GONE_CODES = new Set(['syncStateNotFound', 'syncStateInvalid', 'resyncRequired']);

export type GraphApiFailure =
  | 'unauthorized'
  | 'gone'
  | 'rate_limited'
  | 'server'
  | 'unreachable'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'bad_response';

export class GraphApiError extends Error {
  readonly kind: GraphApiFailure;
  readonly retryAfterMs: number | null;
  readonly status: number | null;
  readonly code: string;

  constructor(
    kind: GraphApiFailure,
    message: string,
    retryAfterMs: number | null = null,
    answer: { status: number; code: string } | null = null,
  ) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.status = answer?.status ?? null;
    this.code = answer?.code ?? '';
  }
}

const text = z.string().max(20_000);
const address = z.object({
  name: z.string().max(1000).nullish(),
  address: z.string().max(1000).nullish(),
});

export const graphCalendarSchema = z.object({
  id: z.string().min(1).max(500),
  name: text.nullish(),
  hexColor: z.string().nullish(),
  canEdit: z.boolean().nullish(),
  isDefaultCalendar: z.boolean().nullish(),
  owner: address.nullish(),
});
export type GraphCalendar = z.infer<typeof graphCalendarSchema>;

const when = z.object({ dateTime: z.string().max(40), timeZone: z.string().max(100).nullish() });

const attendee = z.object({
  type: z.string().nullish(),
  status: z.object({ response: z.string().nullish() }).nullish(),
  emailAddress: address.nullish(),
});

export const graphEventSchema = z.object({
  id: z.string().min(1).max(1024),
  iCalUId: z.string().max(2048).nullish(),
  seriesMasterId: z.string().max(1024).nullish(),
  type: z.string().nullish(),
  subject: text.nullish(),
  body: z
    .object({ contentType: z.string().nullish(), content: z.string().max(200_000).nullish() })
    .nullish(),
  start: when.nullish(),
  end: when.nullish(),
  isAllDay: z.boolean().nullish(),
  isCancelled: z.boolean().nullish(),
  showAs: z.string().nullish(),
  location: z.object({ displayName: text.nullish() }).nullish(),
  webLink: z.string().max(4000).nullish(),
  onlineMeeting: z.object({ joinUrl: z.string().max(4000).nullish() }).nullish(),
  onlineMeetingUrl: z.string().max(4000).nullish(),
  attendees: z.array(attendee).nullish(),
  organizer: z.object({ emailAddress: address.nullish() }).nullish(),
  isOrganizer: z.boolean().nullish(),
  responseStatus: z.object({ response: z.string().nullish() }).nullish(),
  isReminderOn: z.boolean().nullish(),
  reminderMinutesBeforeStart: z.number().int().nullish(),
});
export type GraphEvent = z.infer<typeof graphEventSchema>;

const removedSchema = z.object({
  id: z.string().min(1).max(1024),
  '@removed': z.object({}).loose(),
});

const pageSchema = z.object({
  value: z.array(z.unknown()).optional(),
  '@odata.nextLink': z.string().optional(),
  '@odata.deltaLink': z.string().optional(),
});

const meSchema = z.object({
  mail: z.string().max(320).nullish(),
  userPrincipalName: z.string().max(320).nullish(),
});

export interface GraphApiDeps {
  fetch: typeof fetch;
  graphUrl: string;
  accessToken: string;
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function failureKind(status: number, code: string): GraphApiFailure {
  if (status === 429) return 'rate_limited';
  if (status === 410 || GONE_CODES.has(code)) return 'gone';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'server';
  return 'bad_response';
}

const FAILURE_MESSAGES: Record<GraphApiFailure, string> = {
  rate_limited: 'Microsoft asked Spark to slow down.',
  gone: 'Microsoft asked for a full sync.',
  unauthorized: 'Microsoft sign-in ran out.',
  not_found: 'Microsoft lost that calendar.',
  forbidden: 'Microsoft refused access.',
  bad_request: 'Microsoft can’t read that calendar this way.',
  server: 'Microsoft is having trouble.',
  unreachable: 'Couldn’t reach Microsoft.',
  bad_response: '',
};

async function failureOf(response: Response): Promise<GraphApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  const code = body?.error?.code ?? '';
  const kind = failureKind(response.status, code);
  const message = FAILURE_MESSAGES[kind] || `Microsoft answered ${response.status}.`;
  const waits = kind === 'rate_limited' || kind === 'server';
  return new GraphApiError(kind, message, waits ? retryAfter(response) : null, {
    status: response.status,
    code,
  });
}

interface Send {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export function sameGraphOrigin(graphUrl: string, link: string): boolean {
  try {
    const base = new URL(graphUrl);
    const url = new URL(link);
    return url.origin === base.origin && !url.username && url.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}

async function call(deps: GraphApiDeps, url: string, send: Send): Promise<Response> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: send.method,
      headers: {
        authorization: `Bearer ${deps.accessToken}`,
        accept: 'application/json',
        prefer: PREFER,
        ...(send.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(send.body === undefined ? {} : { body: JSON.stringify(send.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GraphApiError('unreachable', 'Couldn’t reach Microsoft.');
  }
  if (!response.ok) throw await failureOf(response);
  return response;
}

async function getJson(deps: GraphApiDeps, url: string, send: Send = { method: 'GET' }) {
  const response = await call(deps, url, send);
  const data = (await response.json().catch(() => null)) as unknown;
  if (data === null)
    throw new GraphApiError('bad_response', 'Microsoft sent an unreadable answer.');
  return data;
}

const at = (deps: GraphApiDeps, path: string, query?: URLSearchParams) =>
  `${deps.graphUrl}${path}${query ? `?${query.toString()}` : ''}`;

function validItems<T>(schema: z.ZodType<T>, items: readonly unknown[] | undefined): T[] {
  return (items ?? []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function followLink(deps: GraphApiDeps, link: string): string {
  if (!sameGraphOrigin(deps.graphUrl, link)) {
    throw new GraphApiError('bad_response', 'Microsoft sent a link to somewhere else.');
  }
  return link;
}

async function pageAt(deps: GraphApiDeps, url: string) {
  const parsed = pageSchema.safeParse(await getJson(deps, url));
  if (!parsed.success) throw new GraphApiError('bad_response', 'Microsoft sent an odd list.');
  return parsed.data;
}

export async function listMicrosoftCalendars(deps: GraphApiDeps): Promise<GraphCalendar[]> {
  const found: GraphCalendar[] = [];
  let url = at(deps, '/me/calendars');
  for (let page = 0; page < GRAPH_MAX_PAGES; page += 1) {
    const data = await pageAt(deps, url);
    found.push(...validItems(graphCalendarSchema, data.value));
    const next = data['@odata.nextLink'];
    if (!next) break;
    url = followLink(deps, next);
  }
  return found;
}

export async function microsoftMe(deps: GraphApiDeps): Promise<string | null> {
  const query = new URLSearchParams({ $select: 'mail,userPrincipalName' });
  const parsed = meSchema.safeParse(await getJson(deps, at(deps, '/me', query)));
  if (!parsed.success) return null;
  return parsed.data.mail ?? parsed.data.userPrincipalName ?? null;
}

const calendarEvents = (calendarId: string) =>
  `/me/calendars/${encodeURIComponent(calendarId)}/events`;
const eventPath = (calendarId: string, eventId: string) =>
  `${calendarEvents(calendarId)}/${encodeURIComponent(eventId)}`;

function parsedEvent(data: unknown): GraphEvent {
  const parsed = graphEventSchema.safeParse(data);
  if (!parsed.success) throw new GraphApiError('bad_response', 'Microsoft sent an odd event.');
  return parsed.data;
}

export async function getMicrosoftEvent(
  deps: GraphApiDeps,
  calendarId: string,
  eventId: string,
): Promise<GraphEvent> {
  return parsedEvent(await getJson(deps, at(deps, eventPath(calendarId, eventId))));
}

export async function microsoftSeriesUid(
  deps: GraphApiDeps,
  calendarId: string,
  seriesMasterId: string,
): Promise<string | null> {
  const query = new URLSearchParams({ $select: 'iCalUId' });
  const data = (await getJson(deps, at(deps, eventPath(calendarId, seriesMasterId), query))) as {
    iCalUId?: unknown;
  };
  return typeof data.iCalUId === 'string' ? data.iCalUId : null;
}

export type MicrosoftEventsRequest =
  { kind: 'full'; start: string; end: string } | { kind: 'changes'; deltaLink: string };

export interface MicrosoftEventsAnswer {
  events: GraphEvent[];
  removed: string[];
  deltaLink: string | null;
  truncated: boolean;
}

function firstUrl(deps: GraphApiDeps, calendarId: string, request: MicrosoftEventsRequest) {
  if (request.kind === 'changes') return followLink(deps, request.deltaLink);
  const query = new URLSearchParams({ startDateTime: request.start, endDateTime: request.end });
  return at(deps, `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`, query);
}

export async function listMicrosoftWindow(
  deps: GraphApiDeps,
  calendarId: string,
  window: { start: string; end: string },
): Promise<MicrosoftEventsAnswer> {
  const events: GraphEvent[] = [];
  const query = new URLSearchParams({
    startDateTime: window.start,
    endDateTime: window.end,
    $top: String(GRAPH_PAGE_SIZE),
  });
  let url = at(deps, `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`, query);
  for (let page = 0; page < GRAPH_MAX_PAGES; page += 1) {
    const data = await pageAt(deps, url);
    events.push(...validItems(graphEventSchema, data.value));
    const next = data['@odata.nextLink'];
    if (!next) return { events, removed: [], deltaLink: null, truncated: false };
    url = followLink(deps, next);
  }
  return { events, removed: [], deltaLink: null, truncated: true };
}

export async function listMicrosoftEvents(
  deps: GraphApiDeps,
  calendarId: string,
  request: MicrosoftEventsRequest,
): Promise<MicrosoftEventsAnswer> {
  const events: GraphEvent[] = [];
  const removed: string[] = [];
  let url = firstUrl(deps, calendarId, request);
  for (let page = 0; page < GRAPH_MAX_PAGES; page += 1) {
    const data = await pageAt(deps, url);
    for (const item of data.value ?? []) {
      const gone = removedSchema.safeParse(item);
      if (gone.success) {
        removed.push(gone.data.id);
        continue;
      }
      const parsed = graphEventSchema.safeParse(item);
      if (parsed.success) events.push(parsed.data);
    }
    const delta = data['@odata.deltaLink'];
    if (delta) return { events, removed, deltaLink: followLink(deps, delta), truncated: false };
    const next = data['@odata.nextLink'];
    if (!next) return { events, removed, deltaLink: null, truncated: false };
    url = followLink(deps, next);
  }
  return { events, removed, deltaLink: null, truncated: true };
}

export interface MicrosoftEventWrite {
  subject?: string;
  body?: { contentType: 'text'; content: string };
  location?: { displayName: string };
  start?: { dateTime: string; timeZone: 'UTC' };
  end?: { dateTime: string; timeZone: 'UTC' };
  isAllDay?: boolean;
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
}

export async function insertMicrosoftEvent(
  deps: GraphApiDeps,
  calendarId: string,
  body: MicrosoftEventWrite,
): Promise<GraphEvent> {
  const url = at(deps, calendarEvents(calendarId));
  return parsedEvent(await getJson(deps, url, { method: 'POST', body }));
}

export async function patchMicrosoftEvent(
  deps: GraphApiDeps,
  target: { calendarId: string; eventId: string },
  body: MicrosoftEventWrite,
): Promise<GraphEvent> {
  const url = at(deps, eventPath(target.calendarId, target.eventId));
  return parsedEvent(await getJson(deps, url, { method: 'PATCH', body }));
}

export async function deleteMicrosoftEvent(
  deps: GraphApiDeps,
  target: { calendarId: string; eventId: string },
): Promise<void> {
  await call(deps, at(deps, eventPath(target.calendarId, target.eventId)), { method: 'DELETE' });
}
