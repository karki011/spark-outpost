import { clientAddress, readForm } from './body.ts';
import { allowHit, checkAttempts, recordRightCode, reserveAttempt } from './counters.ts';
import { hashPasscode, PASSCODE, sameText } from './crypto.ts';
import type { ShareEnv } from './env.ts';
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
    const { lockedUntil } = await checkAttempts(env.COUNTERS, id, now);
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
  const reservation = await reserveAttempt(env.COUNTERS, id, now);
  if (!reservation.allowed) return lockedOut(record, reservation.lockedUntil, now);
  const code = normaliseCode(form.get('code') ?? '');
  if (await codeMatches(record, code)) {
    await recordRightCode(env.COUNTERS, id);
    const reduced = request.headers.get('sec-ch-prefers-reduced-motion') === 'reduce';
    return pageResponse(200, verifiedPage(id, code, reduced ? 1 : 2, record.theme), {
      'set-cookie': await unlockCookie(key, id, now),
    });
  }
  return pageResponse(401, wrongCodePage(id, record.theme), REDUCED_MOTION_HINT);
}

export async function showContent(request: Request, env: ShareEnv, id: string, now: number) {
  const key = signingKey(env);
  if (!key) return unavailable();
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!(await validFrameToken(key, id, token, now))) return notFound();
  const html = await readShare(env, id, now);
  return html === null ? notFound() : contentResponse(html);
}

export async function report(request: Request, env: ShareEnv, id: string, now: number) {
  const form = await readForm(request, FORM_MAX_BYTES);
  const reason = (form?.get('reason') ?? '').trim();
  if (!form || [...reason].length > MAX_REASON_CHARS) return pageResponse(400, badRequestPage());
  const allowed = await allowHit(
    env.COUNTERS,
    `report:${clientAddress(request)}`,
    now,
    REPORT_LIMIT_PER_HOUR,
    HOUR_MS,
  );
  if (!allowed) return pageResponse(429, tooManyReportsPage());
  const record = await findShare(env, id, now);
  if (!record) return notFound();
  await putReport(env, id, reason, now);
  return pageResponse(200, thanksPage(id, record.theme));
}
