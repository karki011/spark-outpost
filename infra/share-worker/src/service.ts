import { clientKey } from './client.ts';
import { allowHit } from './counters.ts';
import { sameText } from './crypto.ts';
import type { ShareEnv } from './env.ts';
import { jsonError, jsonResponse } from './responses.ts';

export const SERVICE_PATH = '/v1/service';
export const SERVICE_NAME = 'spark-share';
export const LONGEST_EXPIRY_DAYS = 7;
export const SERVICE_LIMIT_PER_HOUR = 60;

const HOUR_MS = 3_600_000;
const BEARER = /^Bearer (.+)$/;

export function maxExpiryDays(env: ShareEnv): number {
  return env.MAX_EXPIRY_DAYS === '1' ? 1 : LONGEST_EXPIRY_DAYS;
}

function uploadKey(env: ShareEnv): string | null {
  return env.UPLOAD_KEY ? env.UPLOAD_KEY : null;
}

export function mayUpload(request: Request, env: ShareEnv): boolean {
  const key = uploadKey(env);
  if (key === null) return true;
  const sent = BEARER.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
  return sent !== null && sameText(sent, key);
}

export const unauthorized = () => jsonError(401, 'unauthorized');

export async function serviceInfo(request: Request, env: ShareEnv, now: number) {
  const own = {
    name: `service:${clientKey(request)}`,
    limit: SERVICE_LIMIT_PER_HOUR,
    windowMs: HOUR_MS,
  };
  if (!(await allowHit(env.COUNTERS, own, now))) return jsonError(429, 'rate_limited');
  if (!mayUpload(request, env)) return unauthorized();
  return jsonResponse(200, {
    service: SERVICE_NAME,
    maxDays: maxExpiryDays(env),
    uploadKey: uploadKey(env) === null ? 'none' : 'required',
  });
}
