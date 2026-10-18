import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  fakeGoogleCalendar,
  type FakeGoogle,
} from '../../apps/server/test/fake-google-calendar.ts';
import type { GoogleEvent } from '../../apps/server/src/calendar/google/api.ts';

export const GOOGLE_STUB_SUBJECT = '1080000000000000042';
export const GOOGLE_STUB_EMAIL = 'spark.tester@gmail.com';

function freshGoogle(): FakeGoogle {
  const google = fakeGoogleCalendar('http://stub');
  google.pageSize = 250;
  google.addUser(GOOGLE_STUB_SUBJECT, GOOGLE_STUB_EMAIL);
  google.addCalendar(GOOGLE_STUB_SUBJECT, {
    id: GOOGLE_STUB_EMAIL,
    summary: GOOGLE_STUB_EMAIL,
    accessRole: 'owner',
    primary: true,
    backgroundColor: '#7cb342',
  });
  return google;
}

let google = freshGoogle();

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

export function handlesGoogle(path: string): boolean {
  return path.startsWith('/google/') || path.startsWith('/google-test/');
}

export async function handleGoogle(req: IncomingMessage, res: ServerResponse, path: string) {
  const url = new URL(req.url ?? '', 'http://stub');
  if (path === '/google-test/reset') {
    google = freshGoogle();
    return send(res, 200, { ok: true });
  }
  if (path === '/google-test/events' && req.method === 'POST') {
    const events = JSON.parse(await body(req)) as GoogleEvent[];
    for (const event of events) google.putEvent(GOOGLE_STUB_SUBJECT, GOOGLE_STUB_EMAIL, event);
    return send(res, 200, { ok: true });
  }
  if (path === '/google-test/calendar' && req.method === 'POST') {
    const entry = JSON.parse(await body(req)) as { id: string; summary: string };
    google.addCalendar(GOOGLE_STUB_SUBJECT, { ...entry, accessRole: 'reader' });
    return send(res, 200, { ok: true });
  }
  if (path === '/google-test/read-only') {
    google.grantedScopes = google.grantedScopes.filter(
      (scope) => !scope.endsWith('/calendar.events'),
    );
    return send(res, 200, { ok: true });
  }
  if (path === '/google-test/expire') {
    google.expireRefreshTokens();
    return send(res, 200, { ok: true });
  }
  if (path === '/google-test/revoked') {
    return send(res, 200, {
      issued: google.refreshTokensOf(GOOGLE_STUB_SUBJECT).length,
      revoked: google
        .refreshTokensOf(GOOGLE_STUB_SUBJECT)
        .filter((token) => google.revoked.has(token)).length,
    });
  }
  const rest = path.slice('/google'.length);
  if (rest === '/o/oauth2/v2/auth') {
    const location = google.authorize(`http://stub${rest}${url.search}`);
    res.writeHead(302, { location }).end();
    return;
  }
  const answer = await google.fetch(`http://stub${rest}${url.search}`, {
    method: req.method ?? 'GET',
    body: req.method === 'POST' ? await body(req) : null,
    headers: { authorization: req.headers.authorization ?? '' },
  });
  res.writeHead(answer.status, { 'content-type': 'application/json' });
  res.end(await answer.text());
}
