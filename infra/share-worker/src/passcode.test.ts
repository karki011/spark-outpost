import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCK_AFTER, LOCK_MS } from './counters.ts';
import { PAGE_POLICY } from './responses.ts';
import {
  call,
  cookieFrom,
  create,
  fakeEnv,
  frameSrc,
  postForm,
  START,
  VALID_CREATE,
  type FakeEnv,
} from './test-fakes.ts';

const CODE = 'ABCD2345';
const WRONG = 'WXYZ6789';
const SECRET_TITLE = 'Secret merger plan';

async function lockedShare(fake: FakeEnv = fakeEnv()) {
  const created = await create(fake, { ...VALID_CREATE, title: SECRET_TITLE, passcode: CODE });
  return { fake, id: created.id };
}

function unlock(fake: FakeEnv, id: string, code: string, now = START) {
  return postForm(fake, `/a/${id}/unlock`, { code }, now);
}

async function wrongTimes(fake: FakeEnv, id: string, count: number, now = START) {
  let last: Response | null = null;
  for (let index = 0; index < count; index++) last = await unlock(fake, id, WRONG, now);
  return last!;
}

describe('passcode shares', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the unlock page without the title, scripts or content', async () => {
    const { fake, id } = await lockedShare();
    const response = await call(fake, `/a/${id}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expect(html).toContain('<title>Locked page</title>');
    expect(html).not.toContain(SECRET_TITLE);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).toMatch(/<label class="hint" for="code">/);
    expect(html).toContain('name="code"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('data-pose="asleep" aria-hidden="true"');
  });

  it('answers a correct code with the verified page, the cookie and a refresh to the page', async () => {
    const { fake, id } = await lockedShare();
    const response = await unlock(fake, id, ' abcd-2345 ');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expect(response.headers.get('set-cookie')).toMatch(
      new RegExp(
        `^__Secure-spark-share-${id}=${id}\\.\\d+\\.[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=/a/${id}; Max-Age=43200$`,
      ),
    );
    expect(html).toContain(`<meta http-equiv="refresh" content="2;url=/a/${id}">`);
    expect(html).toContain(`<a href="/a/${id}">Open the page</a>`);
    expect(html).toContain('role="status"');
    expect(html).toContain('Verified.');
    expect(html).toContain('data-pose="happy" aria-hidden="true"');
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expect(html).not.toContain(SECRET_TITLE);
    expect(html).not.toContain('<script');
    const tiles = [...html.matchAll(/<span class="tile"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(tiles.join('')).toBe(CODE);
  });

  it('refreshes sooner when the browser asks for reduced motion', async () => {
    const { fake, id } = await lockedShare();
    const response = await call(fake, `/a/${id}/unlock`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-ch-prefers-reduced-motion': 'reduce',
      },
      body: `code=${CODE}`,
    });
    expect(await response.text()).toContain(`content="1;url=/a/${id}"`);
  });

  it('opens the shell with the unlock cookie and refuses tampered or borrowed cookies', async () => {
    const { fake, id } = await lockedShare();
    const other = await lockedShare(fake);
    const cookie = cookieFrom(await unlock(fake, id, CODE));
    const value = cookie.split('=')[1]!;
    const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
    const borrowed = `__Secure-spark-share-${other.id}=${value}`;

    const opened = await call(fake, `/a/${id}`, { headers: { cookie } });
    const openedHtml = await opened.text();
    expect(openedHtml).toContain('<iframe');
    expect(openedHtml).toContain(SECRET_TITLE);
    expect((await call(fake, frameSrc(openedHtml))).status).toBe(200);

    expect(
      await (await call(fake, `/a/${id}`, { headers: { cookie: tampered } })).text(),
    ).not.toContain('<iframe');
    expect(
      await (await call(fake, `/a/${other.id}`, { headers: { cookie: borrowed } })).text(),
    ).not.toContain('<iframe');
    const expired = await call(fake, `/a/${id}`, { headers: { cookie } }, START + 43_200_000);
    expect(await expired.text()).not.toContain('<iframe');
  });

  it('answers a wrong code with 401, an alert and never echoes the code', async () => {
    const { fake, id } = await lockedShare();
    const response = await unlock(fake, id, WRONG);
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(html).toContain('role="alert"');
    expect(html).toContain('That code didn’t work');
    expect(html).toContain('data-pose="no" aria-hidden="true"');
    expect(response.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expect(html).not.toContain(WRONG);
    expect(html).not.toContain(SECRET_TITLE);
  });

  it('locks the share for 15 minutes after 5 wrong codes, even for the right code', async () => {
    const { fake, id } = await lockedShare();
    expect((await wrongTimes(fake, id, LOCK_AFTER)).status).toBe(401);
    const locked = await unlock(fake, id, WRONG);
    const lockedHtml = await locked.text();

    expect(locked.status).toBe(429);
    expect(lockedHtml).toContain('Try again in about 15 minutes');
    expect(lockedHtml).toContain('data-pose="sulk" aria-hidden="true"');
    expect(locked.headers.get('content-security-policy')).toBe(PAGE_POLICY);
    expect(lockedHtml).not.toContain(WRONG);
    expect((await unlock(fake, id, CODE, START + 60_000)).status).toBe(429);
    expect((await call(fake, `/a/${id}`, {}, START + 60_000)).status).toBe(429);
    expect((await unlock(fake, id, CODE, START + LOCK_MS)).status).toBe(200);
  });

  it('accepts a correct code as the fifth try and clears every count', async () => {
    const { fake, id } = await lockedShare();
    await wrongTimes(fake, id, LOCK_AFTER - 1);
    expect((await unlock(fake, id, CODE)).status).toBe(200);
    expect(fake.storages.get(`attempts:${id}`)?.values.size).toBe(0);
    expect((await call(fake, `/a/${id}`)).status).toBe(200);
    expect((await wrongTimes(fake, id, LOCK_AFTER)).status).toBe(401);
    expect((await unlock(fake, id, WRONG)).status).toBe(429);
  });

  it('never deletes a share however many wrong codes arrive', async () => {
    const { fake, id } = await lockedShare();
    let now = START;
    for (let cycle = 0; cycle < 10; cycle++) {
      await wrongTimes(fake, id, LOCK_AFTER, now);
      now += LOCK_MS;
    }
    expect(fake.bucket.objects.has(`shares/${id}`)).toBe(true);
    expect((await unlock(fake, id, CODE, now)).status).toBe(200);
  });

  it('checks at most 5 codes when many arrive at once', async () => {
    const { fake, id } = await lockedShare();
    const hashes = vi.spyOn(crypto.subtle, 'deriveBits');
    const wrongCodes = [WRONG, 'WXYZ6788', 'WXYZ6787'];
    const codes = Array.from({ length: 24 }, (_, index) => wrongCodes[index % 3]!);
    const responses = await Promise.all(codes.map((code) => unlock(fake, id, code)));
    const statuses = responses.map((response) => response.status);

    expect(hashes).toHaveBeenCalledTimes(LOCK_AFTER);
    expect(statuses.filter((status) => status === 401)).toHaveLength(LOCK_AFTER);
    expect(statuses.filter((status) => status === 429)).toHaveLength(codes.length - LOCK_AFTER);
  });

  it('lets a correct code among the first five through when they arrive at once', async () => {
    const { fake, id } = await lockedShare();
    const codes = [WRONG, WRONG, CODE, WRONG, WRONG, WRONG, WRONG];
    const responses = await Promise.all(codes.map((code) => unlock(fake, id, code)));
    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(LOCK_AFTER - 1);
    expect(statuses.filter((status) => status === 429)).toHaveLength(codes.length - LOCK_AFTER);
  });

  it('refuses an unlock request that is not a form', async () => {
    const { fake, id } = await lockedShare();
    const response = await call(fake, `/a/${id}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    });
    expect(response.status).toBe(400);
  });

  it('has no unlock for a share without a passcode', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    expect((await unlock(fake, id, CODE)).status).toBe(404);
  });
});
