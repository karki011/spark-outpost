import { createShare, deleteShare } from './api.ts';
import type { ShareEnv } from './env.ts';
import { methodPage } from './pages.ts';
import { jsonError, pageResponse } from './responses.ts';
import { removeExpired } from './storage.ts';
import { notFound, report, showContent, showShell, unlock } from './viewer.ts';

export { ShareCounters } from './counters.ts';

type Handler = (request: Request, env: ShareEnv, id: string, now: number) => Promise<Response>;

interface ScheduledContext {
  waitUntil(promise: Promise<unknown>): void;
}

const SHARES_PATH = '/v1/shares';
const SHARE_DELETE = /^\/v1\/shares\/([A-Za-z0-9_-]{22,43})$/;
const VIEWER = /^\/a\/([A-Za-z0-9_-]{22,43})(\/unlock|\/content|\/report)?$/;

const VIEWER_ROUTES: Record<string, { method: string; handler: Handler }> = {
  '': { method: 'GET', handler: showShell },
  '/unlock': { method: 'POST', handler: unlock },
  '/content': { method: 'GET', handler: showContent },
  '/report': { method: 'POST', handler: report },
};

const apiMethodNotAllowed = (allow: string) => jsonError(405, 'method_not_allowed', { allow });

async function route(request: Request, env: ShareEnv, now: number): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === SHARES_PATH) {
    if (request.method !== 'POST') return apiMethodNotAllowed('POST');
    return createShare(request, env, now);
  }
  const deleteMatch = SHARE_DELETE.exec(path);
  if (deleteMatch) {
    if (request.method !== 'DELETE') return apiMethodNotAllowed('DELETE');
    return deleteShare(request, env, deleteMatch[1]!, now);
  }
  const viewerMatch = VIEWER.exec(path);
  if (viewerMatch) {
    const viewerRoute = VIEWER_ROUTES[viewerMatch[2] ?? '']!;
    if (request.method !== viewerRoute.method) {
      return pageResponse(405, methodPage(), { allow: viewerRoute.method });
    }
    return viewerRoute.handler(request, env, viewerMatch[1]!, now);
  }
  if (path.startsWith('/v1/')) return jsonError(404, 'not_found');
  return notFound();
}

export async function handleRequest(
  request: Request,
  env: ShareEnv,
  now: number = Date.now(),
): Promise<Response> {
  try {
    return await route(request, env, now);
  } catch {
    return jsonError(500, 'internal_error');
  }
}

export default {
  fetch: (request: Request, env: ShareEnv) => handleRequest(request, env),
  scheduled: (_controller: unknown, env: ShareEnv, context: ScheduledContext) => {
    context.waitUntil(removeExpired(env, Date.now()));
  },
};
