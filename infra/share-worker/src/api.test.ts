import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CREATE_LIMIT_PER_HOUR, MAX_CREATE_BODY_BYTES, MAX_HTML_BYTES } from './api.ts';
import {
  call,
  create,
  fakeEnv,
  freshIds,
  ORIGIN,
  postForm,
  postJson,
  remove,
  START,
  VALID_CREATE,
  type FakeEnv,
} from './test-fakes.ts';
import worker from './worker.ts';

const DAY = 86_400_000;

function metadataOf(fake: FakeEnv, id: string) {
  return fake.bucket.objects.get(`shares/${id}`)?.options.customMetadata;
}

describe('POST /v1/shares', () => {
  it('stores the page at the id its delete token gives and answers with its link', async () => {
    const fake = fakeEnv();
    const response = await postJson(fake, VALID_CREATE);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      id: VALID_CREATE.id,
      url: `${ORIGIN}/a/${VALID_CREATE.id}`,
      expiresAt: new Date(START + 7 * DAY).toISOString(),
    });
    expect(fake.bucket.objects.get(`shares/${body.id}`)?.value).toBe(VALID_CREATE.html);
  });

  it('keeps only a hash of the delete token and of the passcode', async () => {
    const fake = fakeEnv();
    const created = await create(fake, { ...VALID_CREATE, passcode: 'ABCD2345' });
    const metadata = metadataOf(fake, created.id)!;
    const stored = JSON.stringify(metadata);

    expect(stored).not.toContain(created.deleteToken);
    expect(stored).not.toContain('ABCD2345');
    expect(metadata.deleteTokenHash).toBe(
      createHash('sha256').update(created.deleteToken).digest('base64url'),
    );
    expect(metadata.passcodeIterations).toBe('100000');
    expect(metadata.passcodeSalt).toBeTruthy();
  });

  it('answers a retry with the same id and token with the stored share, unchanged', async () => {
    const fake = fakeEnv();
    const first = await (await postJson(fake, VALID_CREATE)).json();
    const retry = await postJson(
      fake,
      { ...VALID_CREATE, html: '<p>other</p>', expiresInDays: 1 },
      { now: START + 60_000 },
    );

    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
    expect(fake.bucket.objects.get(`shares/${first.id}`)?.value).toBe(VALID_CREATE.html);
  });

  it('refuses an id that its delete token does not give and writes nothing', async () => {
    const fake = fakeEnv();
    const other = await freshIds();
    const pairs = [
      { id: other.id, deleteToken: VALID_CREATE.deleteToken },
      { id: VALID_CREATE.id, deleteToken: other.deleteToken },
      { id: 'Ab3_-Ab3_-Ab3_-Ab3_-Ab', deleteToken: VALID_CREATE.deleteToken },
    ];
    for (const pair of pairs) {
      const response = await postJson(fake, { ...VALID_CREATE, ...pair });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_request' });
    }
    expect(fake.bucket.objects.size).toBe(0);
  });

  it('refuses a taken id with another token and changes nothing', async () => {
    const fake = fakeEnv();
    await postJson(fake, VALID_CREATE);
    const before = structuredClone(fake.bucket.objects.get(`shares/${VALID_CREATE.id}`));
    const response = await postJson(fake, {
      ...VALID_CREATE,
      deleteToken: 'Z'.repeat(43),
      html: '<p>takeover</p>',
    });

    expect(response.status).toBe(400);
    expect(fake.bucket.objects.get(`shares/${VALID_CREATE.id}`)).toEqual(before);
    expect(fake.bucket.objects.size).toBe(1);
  });

  it('answers 409 for a taken id whose stored record cannot be read', async () => {
    const fake = fakeEnv();
    await fake.bucket.put(`shares/${VALID_CREATE.id}`, '<p>odd</p>');
    expect((await postJson(fake, VALID_CREATE)).status).toBe(409);
    expect(fake.bucket.objects.get(`shares/${VALID_CREATE.id}`)?.value).toBe('<p>odd</p>');
  });

  it('never gives an expired id to another uploader and leaves no marker for it', async () => {
    const fake = fakeEnv();
    await postJson(fake, { ...VALID_CREATE, expiresInDays: 1 });
    const later = START + 2 * DAY;
    const takeover = { ...VALID_CREATE, deleteToken: 'Z'.repeat(43), html: '<p>new</p>' };

    expect((await postJson(fake, takeover, { now: later })).status).toBe(400);
    expect((await call(fake, `/a/${VALID_CREATE.id}`, {}, later)).status).toBe(404);
    expect((await postJson(fake, takeover, { now: later })).status).toBe(400);
    expect(fake.bucket.objects.size).toBe(0);
  });

  it('lets only the key holder use an expired id again', async () => {
    const fake = fakeEnv();
    await postJson(fake, { ...VALID_CREATE, expiresInDays: 1 });
    const later = START + 2 * DAY;

    expect((await postJson(fake, VALID_CREATE, { now: later })).status).toBe(409);
    const again = await postJson(fake, { ...VALID_CREATE, html: '<p>mine</p>' }, { now: later });
    expect(again.status).toBe(201);
    expect(fake.bucket.objects.get(`shares/${VALID_CREATE.id}`)?.value).toBe('<p>mine</p>');
  });

  it('never gives a deleted id to another uploader, or back to the first one', async () => {
    const fake = fakeEnv();
    await postJson(fake, VALID_CREATE);
    await remove(fake, VALID_CREATE.id as string, VALID_CREATE.deleteToken as string);
    const takeover = { ...VALID_CREATE, deleteToken: 'Z'.repeat(43), html: '<p>new</p>' };

    const response = await postJson(fake, takeover);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    const original = await postJson(fake, VALID_CREATE);
    expect(original.status).toBe(409);
    expect(await original.json()).toEqual({ error: 'conflict' });
    expect((await call(fake, `/a/${VALID_CREATE.id}`)).status).toBe(404);
    expect([...fake.bucket.objects.keys()]).toEqual([`gone/${VALID_CREATE.id}`]);
  });

  it('refuses a create that lands after a delete of the same id', async () => {
    const fake = fakeEnv();
    const missing = await remove(
      fake,
      VALID_CREATE.id as string,
      VALID_CREATE.deleteToken as string,
    );
    expect(missing.status).toBe(404);

    expect((await postJson(fake, VALID_CREATE)).status).toBe(409);
    expect((await call(fake, `/a/${VALID_CREATE.id}`)).status).toBe(404);
    expect(fake.bucket.objects.has(`shares/${VALID_CREATE.id}`)).toBe(false);
  });

  it('takes back a page stored while its id was being retired', async () => {
    const fake = fakeEnv();
    const head = fake.bucket.head.bind(fake.bucket);
    let checks = 0;
    fake.bucket.head = async (key) => {
      if (key === `gone/${VALID_CREATE.id}`) {
        checks += 1;
        if (checks === 2) await fake.bucket.put(key, '');
      }
      return head(key);
    };

    expect((await postJson(fake, VALID_CREATE)).status).toBe(409);
    expect(checks).toBe(2);
    expect(fake.bucket.objects.has(`shares/${VALID_CREATE.id}`)).toBe(false);
  });

  it('refuses a repeat that finds a page written after its id was retired', async () => {
    const fake = fakeEnv();
    const put = fake.bucket.put.bind(fake.bucket);
    let crossed = false;
    fake.bucket.put = async (key, value, options) => {
      if (key === `shares/${VALID_CREATE.id}` && !crossed) {
        crossed = true;
        await put(`gone/${VALID_CREATE.id}`, '');
        await put(key, value, options);
      }
      return put(key, value, options);
    };

    const response = await postJson(fake, VALID_CREATE);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict' });
    expect([...fake.bucket.objects.keys()]).toEqual([`gone/${VALID_CREATE.id}`]);
    expect((await call(fake, `/a/${VALID_CREATE.id}`)).status).toBe(404);
  });

  it('refuses a retired id before writing anything under it', async () => {
    const fake = fakeEnv();
    await fake.bucket.put(`gone/${VALID_CREATE.id}`, '');
    const put = fake.bucket.put.bind(fake.bucket);
    const written: string[] = [];
    fake.bucket.put = async (key, value, options) => {
      written.push(key);
      return put(key, value, options);
    };

    expect((await postJson(fake, VALID_CREATE)).status).toBe(409);
    expect(written).toEqual([]);
  });

  it.each([
    ['not JSON', 'hello'],
    ['an array', '[]'],
    ['an unknown field', { ...VALID_CREATE, author: 'me' }],
    ['a missing title', { html: '<p>', expiresInDays: 1 }],
    ['an empty title', { ...VALID_CREATE, title: '' }],
    ['a blank title', { ...VALID_CREATE, title: '   ' }],
    ['a long title', { ...VALID_CREATE, title: 'x'.repeat(121) }],
    ['html that is not a string', { ...VALID_CREATE, html: 5 }],
    ['an unsupported expiry', { ...VALID_CREATE, expiresInDays: 3 }],
    ['an expiry as text', { ...VALID_CREATE, expiresInDays: '7' }],
    ['a short passcode', { ...VALID_CREATE, passcode: 'ABC2345' }],
    ['a passcode with I or 0', { ...VALID_CREATE, passcode: 'ABCDI230' }],
    ['a lowercase passcode', { ...VALID_CREATE, passcode: 'abcd2345' }],
    ['a null passcode', { ...VALID_CREATE, passcode: null }],
    ['a missing id', { ...VALID_CREATE, id: undefined }],
    ['a 21 character id', { ...VALID_CREATE, id: 'a'.repeat(21) }],
    ['a 23 character id', { ...VALID_CREATE, id: 'a'.repeat(23) }],
    ['an id with a bad character', { ...VALID_CREATE, id: `${'a'.repeat(21)}.` }],
    ['an id that is not a string', { ...VALID_CREATE, id: 5 }],
    ['a missing delete token', { ...VALID_CREATE, deleteToken: undefined }],
    ['a 42 character delete token', { ...VALID_CREATE, deleteToken: 'a'.repeat(42) }],
    ['a 44 character delete token', { ...VALID_CREATE, deleteToken: 'a'.repeat(44) }],
    ['a delete token with a bad character', { ...VALID_CREATE, deleteToken: `${'a'.repeat(42)}=` }],
  ])('rejects %s with 400 invalid_request', async (_name, body) => {
    const fake = fakeEnv();
    const response = await postJson(fake, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(fake.bucket.objects.size).toBe(0);
  });

  it('accepts a 120 character title counted in code points', async () => {
    const fake = fakeEnv();
    expect((await postJson(fake, { ...VALID_CREATE, title: '🙂'.repeat(120) })).status).toBe(201);
  });

  it('rejects a body not declared as JSON', async () => {
    const fake = fakeEnv();
    const response = await call(fake, '/v1/shares', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(VALID_CREATE),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('accepts html of exactly 2 MiB and refuses one byte more with 413', async () => {
    const fake = fakeEnv();
    const exact = await postJson(fake, { ...VALID_CREATE, html: 'a'.repeat(MAX_HTML_BYTES) });
    const over = await postJson(fake, { ...VALID_CREATE, html: 'a'.repeat(MAX_HTML_BYTES + 1) });

    expect(exact.status).toBe(201);
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'too_large' });
  });

  it('counts html size in UTF-8 bytes', async () => {
    const fake = fakeEnv();
    const html = 'é'.repeat(MAX_HTML_BYTES / 2 + 1);
    expect((await postJson(fake, { ...VALID_CREATE, html })).status).toBe(413);
  });

  it('stops reading a body over the cap with 413', async () => {
    const fake = fakeEnv();
    const response = await postJson(fake, 'x'.repeat(MAX_CREATE_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_large' });
  });

  it('allows 20 creates per hour per address, then answers 429', async () => {
    const fake = fakeEnv();
    for (let index = 0; index < CREATE_LIMIT_PER_HOUR; index++) await create(fake);
    const limited = await postJson(fake, VALID_CREATE);
    const otherAddress = await postJson(fake, VALID_CREATE, { ip: '198.51.100.4' });
    const nextHour = await postJson(fake, VALID_CREATE, { now: START + 3_600_000 });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(otherAddress.status).toBe(201);
    expect(nextHour.status).toBe(201);
  });

  it('answers 405 with Allow for other methods', async () => {
    const response = await call(fakeEnv(), '/v1/shares', { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const response = await call(fakeEnv(), '/v1/other');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('sends the common security headers on JSON responses', async () => {
    const response = await postJson(fakeEnv(), VALID_CREATE);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('expiry', () => {
  it('serves nothing after expiry and deletes the object on read', async () => {
    const fake = fakeEnv();
    const created = await postJson(fake, { ...VALID_CREATE, expiresInDays: 1 });
    const { id } = await created.json();

    expect((await call(fake, `/a/${id}`, {}, START + DAY - 1)).status).toBe(200);
    expect((await call(fake, `/a/${id}`, {}, START + DAY)).status).toBe(404);
    expect(fake.bucket.objects.size).toBe(0);
  });

  it('deletes expired shares across every page in the daily run', async () => {
    const fake = fakeEnv({ pageSize: 2 });
    const short = [];
    for (let index = 0; index < 3; index++) {
      short.push(await create(fake, { ...VALID_CREATE, expiresInDays: 1 }));
    }
    const long = await create(fake, { ...VALID_CREATE, expiresInDays: 7 });
    const locked = await create(fake, { ...VALID_CREATE, expiresInDays: 1, passcode: 'ABCD2345' });
    await postForm(fake, `/a/${locked.id}/unlock`, { code: 'WXYZ2345' });
    await fake.bucket.put('reports/x/1-a', '{}');
    expect(fake.storages.get(`attempts:${locked.id}`)?.values.size).toBeGreaterThan(0);

    const waited: Promise<unknown>[] = [];
    vi.spyOn(Date, 'now').mockReturnValue(START + 2 * DAY);
    worker.scheduled(undefined, fake.env, { waitUntil: (promise) => waited.push(promise) });
    await Promise.all(waited);
    vi.restoreAllMocks();

    const keys = [...fake.bucket.objects.keys()].sort();
    expect(short).toHaveLength(3);
    expect(keys).toEqual([`shares/${long.id}`, 'reports/x/1-a'].sort());
    expect(fake.storages.get(`attempts:${locked.id}`)?.values.size).toBe(0);
  });
});
