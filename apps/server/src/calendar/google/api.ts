import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 30_000;
export const GOOGLE_PAGE_SIZE = 250;
export const GOOGLE_MAX_PAGES = 20;

export type GoogleApiFailure =
  | 'unauthorized'
  | 'gone'
  | 'rate_limited'
  | 'server'
  | 'unreachable'
  | 'forbidden'
  | 'not_found'
  | 'bad_response';

export class GoogleApiError extends Error {
  readonly kind: GoogleApiFailure;
  readonly retryAfterMs: number | null;

  constructor(kind: GoogleApiFailure, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

const text = z.string().max(20_000);

export const googleCalendarEntrySchema = z.object({
  id: z.string().min(1).max(300),
  summary: text.optional(),
  summaryOverride: text.optional(),
  backgroundColor: z.string().optional(),
  accessRole: z.enum(['freeBusyReader', 'reader', 'writer', 'owner']),
  primary: z.boolean().optional(),
  deleted: z.boolean().optional(),
});
export type GoogleCalendarEntry = z.infer<typeof googleCalendarEntrySchema>;

const when = z.object({
  date: z.iso.date().optional(),
  dateTime: z.iso.datetime({ offset: true }).optional(),
  timeZone: z.string().optional(),
});

const attendee = z.object({
  displayName: z.string().max(1000).optional(),
  email: z.string().max(1000).optional(),
  self: z.boolean().optional(),
  resource: z.boolean().optional(),
  responseStatus: z.string().optional(),
});

const entryPoint = z.object({ entryPointType: z.string().optional(), uri: z.string().optional() });

export const googleEventSchema = z.object({
  id: z.string().min(1).max(1024),
  status: z.string().optional(),
  iCalUID: z.string().max(1024).optional(),
  summary: text.optional(),
  description: z.string().max(100_000).optional(),
  location: text.optional(),
  htmlLink: z.string().max(2000).optional(),
  hangoutLink: z.string().max(2000).optional(),
  start: when.optional(),
  end: when.optional(),
  transparency: z.string().optional(),
  recurringEventId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  attendees: z.array(attendee).optional(),
  conferenceData: z.object({ entryPoints: z.array(entryPoint).optional() }).optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

const calendarPageSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
});

const eventPageSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

export interface GoogleApiDeps {
  fetch: typeof fetch;
  apiUrl: string;
  accessToken: string;
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function failureOf(response: Response): Promise<GoogleApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[] };
  } | null;
  const reasons = body?.error?.errors?.map((item) => item.reason ?? '') ?? [];
  const rate = response.status === 429 || reasons.some((reason) => RATE_REASONS.has(reason));
  if (rate) {
    return new GoogleApiError(
      'rate_limited',
      'Google asked Spark to slow down.',
      retryAfter(response),
    );
  }
  if (response.status === 401) return new GoogleApiError('unauthorized', 'Google sign-in ran out.');
  if (response.status === 410) return new GoogleApiError('gone', 'Google asked for a full sync.');
  if (response.status === 404) return new GoogleApiError('not_found', 'Google lost that calendar.');
  if (response.status === 403) return new GoogleApiError('forbidden', 'Google refused access.');
  if (response.status >= 500) {
    return new GoogleApiError('server', 'Google is having trouble.', retryAfter(response));
  }
  return new GoogleApiError('bad_response', `Google answered ${response.status}.`);
}

async function getJson(deps: GoogleApiDeps, path: string, query: URLSearchParams) {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.apiUrl}${path}?${query.toString()}`, {
      headers: { authorization: `Bearer ${deps.accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleApiError('unreachable', 'Couldn’t reach Google.');
  }
  if (!response.ok) throw await failureOf(response);
  const data = (await response.json().catch(() => null)) as unknown;
  if (data === null) throw new GoogleApiError('bad_response', 'Google sent an unreadable answer.');
  return data;
}

function validItems<T>(schema: z.ZodType<T>, items: readonly unknown[] | undefined): T[] {
  return (items ?? []).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function listGoogleCalendars(deps: GoogleApiDeps): Promise<GoogleCalendarEntry[]> {
  const found: GoogleCalendarEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ maxResults: String(GOOGLE_PAGE_SIZE) });
    if (pageToken) query.set('pageToken', pageToken);
    const parsed = calendarPageSchema.safeParse(
      await getJson(deps, '/users/me/calendarList', query),
    );
    if (!parsed.success) throw new GoogleApiError('bad_response', 'Google sent an odd list.');
    found.push(...validItems(googleCalendarEntrySchema, parsed.data.items));
    pageToken = parsed.data.nextPageToken;
    if (!pageToken) break;
  }
  return found.filter((entry) => !entry.deleted && entry.accessRole !== 'freeBusyReader');
}

export async function getGoogleEvent(
  deps: GoogleApiDeps,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const parsed = googleEventSchema.safeParse(await getJson(deps, path, new URLSearchParams()));
  if (!parsed.success) throw new GoogleApiError('bad_response', 'Google sent an odd event.');
  return parsed.data;
}

export type GoogleEventsRequest =
  { kind: 'full'; timeMin: string; timeMax: string } | { kind: 'changes'; syncToken: string };

export interface GoogleEventsAnswer {
  events: GoogleEvent[];
  syncToken: string | null;
  truncated: boolean;
}

function eventsQuery(request: GoogleEventsRequest, pageToken: string | undefined) {
  const query = new URLSearchParams({
    singleEvents: 'true',
    maxResults: String(GOOGLE_PAGE_SIZE),
  });
  if (request.kind === 'full') {
    query.set('timeMin', request.timeMin);
    query.set('timeMax', request.timeMax);
  } else {
    query.set('syncToken', request.syncToken);
  }
  if (pageToken) query.set('pageToken', pageToken);
  return query;
}

export async function listGoogleEvents(
  deps: GoogleApiDeps,
  calendarId: string,
  request: GoogleEventsRequest,
): Promise<GoogleEventsAnswer> {
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
    const parsed = eventPageSchema.safeParse(
      await getJson(deps, path, eventsQuery(request, pageToken)),
    );
    if (!parsed.success) throw new GoogleApiError('bad_response', 'Google sent odd events.');
    events.push(...validItems(googleEventSchema, parsed.data.items));
    if (parsed.data.nextSyncToken) {
      return { events, syncToken: parsed.data.nextSyncToken, truncated: false };
    }
    pageToken = parsed.data.nextPageToken;
    if (!pageToken) return { events, syncToken: null, truncated: false };
  }
  return { events, syncToken: null, truncated: true };
}
