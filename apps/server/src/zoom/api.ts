import { z } from 'zod';
import { ZoomError, type ZoomDeps } from './oauth.ts';

const REQUEST_TIMEOUT_MS = 20_000;

export class ZoomUnauthorized extends Error {}

async function call(
  deps: ZoomDeps,
  accessToken: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.client.apiUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ZoomError('unreachable', 'Couldn’t reach Zoom. Check your connection.');
  }
  if (response.status === 401) throw new ZoomUnauthorized();
  if (response.status === 429) {
    throw new ZoomError('busy', 'Zoom’s limit on new meetings was reached. Try again later.');
  }
  if (response.status >= 500) throw new ZoomError('busy', 'Zoom is busy right now. Try again.');
  if (!response.ok) {
    throw new ZoomError('refused', `Zoom refused the request (${response.status}).`);
  }
  return response.status === 204 ? null : ((await response.json().catch(() => null)) as unknown);
}

const userSchema = z.object({ id: z.string().min(1).max(200), email: z.string().min(3).max(320) });

export interface ZoomUser {
  id: string;
  email: string;
}

export async function getZoomUser(deps: ZoomDeps, accessToken: string): Promise<ZoomUser> {
  const parsed = userSchema.safeParse(
    await call(deps, accessToken, '/users/me', { method: 'GET' }),
  );
  if (!parsed.success) throw new ZoomError('bad_response', 'Zoom sent an odd account.');
  return parsed.data;
}

const meetingSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]),
  join_url: z.url().max(2000),
});

export interface ZoomMeetingRequest {
  topic: string;
  start: string;
  minutes: number;
}

export interface ZoomMeeting {
  id: string;
  joinUrl: string;
}

export async function createZoomMeeting(
  deps: ZoomDeps,
  accessToken: string,
  request: ZoomMeetingRequest,
): Promise<ZoomMeeting> {
  const body = {
    topic: request.topic.slice(0, 200),
    type: 2,
    start_time: new Date(request.start).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: request.minutes,
  };
  const parsed = meetingSchema.safeParse(
    await call(deps, accessToken, '/users/me/meetings', { method: 'POST', body }),
  );
  if (!parsed.success || new URL(parsed.data.join_url).protocol !== 'https:') {
    throw new ZoomError('bad_response', 'Zoom sent an odd meeting.');
  }
  return { id: String(parsed.data.id), joinUrl: parsed.data.join_url };
}

export async function deleteZoomMeeting(
  deps: ZoomDeps,
  accessToken: string,
  meetingId: string,
): Promise<void> {
  await call(deps, accessToken, `/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
}
