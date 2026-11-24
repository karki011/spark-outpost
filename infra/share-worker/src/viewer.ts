import { readForm } from './body.ts';
import { clientKey } from './client.ts';
import { allowHit, checkAttempts, recordRightCode, reserveAttempt } from './counters.ts';
import { hashPasscode, PASSCODE, sameText } from './crypto.ts';
import type { ShareEnv } from './env.ts';
import { recordEvent } from './events.ts';
import { lockedOutPage, unlockPage, verifiedPage, wrongCodePage } from './lock-pages.ts';
import {
  badRequestPage,
  notFoundPage,
  shellPage,
  thanksPage,
  tooManyReportsPage,
  unavailablePage,
} from './pages.ts';
import { contentResponse, pageResponse } from './responses.ts';
import { findShare, putReport, readShare, type ShareRecord } from './storage.ts';
import { frameToken, hasUnlockCookie, unlockCookie, validFrameToken } from './tokens.ts';

const MIN_SIGNING_KEY_LENGTH = 32;
export const REPORT_LIMIT_PER_HOUR = 10;
const MAX_REASON_CHARS = 500;

const FORM_MAX_BYTES = 4096;
const HOUR_MS = 3_600_000;
const REDUCED_MOTION_HINT = { 'accept-ch': 'Sec-CH-Prefers-Reduced-Motion' };

function signingKey(env: ShareEnv): string | null {
  const key = env.SIGNING_KEY ?? '';
  return key.length >= MIN_SIGNING_KEY_LENGTH ? key : null;
}

export const notFound = () => pageResponse(404, notFoundPage());
const unavailable = () => pageResponse(503, unavailablePage());

function lockedOut(record: ShareRecord, lockedUntil: number, now: number) {
  const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
  return pageResponse(429, lockedOutPage(record.id, minutes, record.theme), REDUCED_MOTION_HINT);
}

function normaliseCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

async function codeMatches(record: ShareRecord, code: string): Promise<boolean> {
  if (!record.passcode || !PASSCODE.test(code)) return false;
  const { salt, hash, iterations } = record.passcode;
  return sameText(await hashPasscode(code, salt, iterations), hash);
}

export async function showShell(request: Request, env: ShareEnv, id: string, now: number) {
  const key = signingKey(env);
  if (!key) return unavailable();
  const record = await findShare(env, id, now);
  if (!record) return notFound();
  if (record.passcode && !(await hasUnlockCookie(key, id, request.headers.get('cookie'), now))) {
    const { lockedUntil } = await checkAttempts(env.COUNTERS, id, clientKey(request), now);
    if (lockedUntil) return lockedOut(record, lockedUntil, now);
    return pageResponse(200, unlockPage(id, record.theme), REDUCED_MOTION_HINT);
  }
  const src = `/a/${id}/content?t=${await frameToken(key, id, now)}`;
  return pageResponse(200, shellPage(id, record.title, src, record.theme));
}

export async function unlock(request: Request, env: ShareEnv, id: string, now: number) {
  const key = signingKey(env);
  if (!key) return unavailable();
  const record = await findShare(env, id, now);
  if (!record?.passcode) return notFound();
  const form = await readForm(request, FORM_MAX_BYTES);
  if (!form) return pageResponse(400, badRequestPage());
  const client = clientKey(request);
  const reservation = await reserveAttempt(env.COUNTERS, id, client, now);
  if (!reservation.allowed) {
    recordEvent(env, 'unlock_locked');
    return lockedOut(record, reservation.lockedUntil, now);
  }
  const code = normaliseCode(form.get('code') ?? '');
  if (await codeMatches(record, code)) {
    await recordRightCode(env.COUNTERS, id, client);
    recordEvent(env, 'unlock_ok');
    const reduced = request.headers.get('sec-ch-prefers-reduced-motion') === 'reduce';
    return pageResponse(200, verifiedPage(id, code, reduced ? 1 : 2, record.theme), {
      'set-cookie': await unlockCookie(key, id, now),
    });
  }
  recordEvent(env, 'unlock_wrong');
  return pageResponse(401, wrongCodePage(id, record.theme), REDUCED_MOTION_HINT);
}

export async function showContent(request: Request, env: ShareEnv, id: string, now: number) {
  const key = signingKey(env);
  if (!key) return unavailable();
  const destination = request.headers.get('sec-fetch-dest');
  if (destination !== null && destination !== 'iframe') return notFound();
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!(await validFrameToken(key, id, token, now))) return notFound();
  const share = await readShare(env, id, now);
  if (!share) return notFound();
  const unlocked =
    !share.record.passcode || (await hasUnlockCookie(key, id, request.headers.get('cookie'), now));
  if (!unlocked) return notFound();
  recordEvent(env, 'share_viewed');
  return contentResponse(share.html);
}

function fromOwnPage(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  return request.headers.get('origin') === new URL(request.url).origin;
}

export async function report(request: Request, env: ShareEnv, id: string, now: number) {
  if (!fromOwnPage(request)) return pageResponse(400, badRequestPage());
  const form = await readForm(request, FORM_MAX_BYTES);
  const reason = (form?.get('reason') ?? '').trim();
  if (!form || [...reason].length > MAX_REASON_CHARS) return pageResponse(400, badRequestPage());
  const own = {
    name: `report:${clientKey(request)}`,
    limit: REPORT_LIMIT_PER_HOUR,
    windowMs: HOUR_MS,
  };
  if (!(await allowHit(env.COUNTERS, own, now))) return pageResponse(429, tooManyReportsPage());
  const record = await findShare(env, id, now);
  if (!record) return notFound();
  await putReport(env, id, reason, now);
  recordEvent(env, 'report_filed');
  return pageResponse(200, thanksPage(id, record.theme));
}
