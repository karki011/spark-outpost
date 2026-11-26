import { describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_SHARE_SERVICE_NAME,
  ARTIFACT_SHARE_SERVICE_PATH,
  ARTIFACT_SHARE_UPLOAD_KEY_PATTERN,
  shareServiceInfoSchema,
} from '../../../packages/contracts/src/artifact-shares.ts';
import { CREATE_LIMIT_PER_HOUR } from './api.ts';
import { SERVICE_LIMIT_PER_HOUR, SERVICE_NAME, SERVICE_PATH } from './service.ts';
import {
  call,
  create,
  fakeEnv,
  freshIds,
  postJson,
  remove,
  START,
  VALID_CREATE,
  type FakeEnv,
} from './test-fakes.ts';

const UPLOAD_KEY = 'u'.repeat(64);
const WRONG_KEY = 'w'.repeat(64);
const DAY = 86_400_000;

function createWith(fake: FakeEnv, authorization: string | null, body: unknown = VALID_CREATE) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return call(fake, '/v1/shares', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function service(fake: FakeEnv, authorization: string | null = null, ip?: string) {
  const headers: Record<string, string> = authorization === null ? {} : { authorization };
  return call(fake, SERVICE_PATH, { headers, ...(ip ? { ip } : {}) });
}

describe('the worker and the app agree on the service contract', () => {
  it('uses the same path and name', () => {
    expect(SERVICE_PATH).toBe(ARTIFACT_SHARE_SERVICE_PATH);
    expect(SERVICE_NAME).toBe(ARTIFACT_SHARE_SERVICE_NAME);
  });

  it('tests with an upload key the app would accept', () => {
    expect(UPLOAD_KEY).toMatch(ARTIFACT_SHARE_UPLOAD_KEY_PATTERN);
  });
});

describe('with an upload key set', () => {
  it('refuses a create without the key, with a wrong key or with another scheme', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    const attempts = [
      null,
      `Bearer ${WRONG_KEY}`,
      `Bearer ${UPLOAD_KEY}x`,
      `Bearer ${UPLOAD_KEY.slice(1)}`,
      `Basic ${UPLOAD_KEY}`,
      UPLOAD_KEY,
      'Bearer ',
    ];
    for (const authorization of attempts) {
      const response = await createWith(fake, authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(fake.bucket.objects.size).toBe(0);
    expect(fake.storages.has('rate:create:all')).toBe(false);
  });

  it('answers 401 before it reads the body', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    const response = await createWith(fake, null, 'not json');

    expect(response.status).toBe(401);
  });

  it('stores the page when the key is right', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    const response = await createWith(fake, `Bearer ${UPLOAD_KEY}`);

    expect(response.status).toBe(201);
    expect(fake.bucket.objects.get(`shares/${VALID_CREATE.id}`)?.value).toBe(VALID_CREATE.html);
  });

  it('counts refused creates against the client, so guessing is rate limited', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    for (let index = 0; index < CREATE_LIMIT_PER_HOUR; index++) {
      expect((await createWith(fake, `Bearer ${WRONG_KEY}`)).status).toBe(401);
    }
    const limited = await createWith(fake, `Bearer ${UPLOAD_KEY}`);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
  });

  it('records a refused create without the key it carried', async () => {
    const writeDataPoint = vi.fn();
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY, events: { writeDataPoint } });
    await createWith(fake, `Bearer ${WRONG_KEY}`);

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint.mock.calls[0]![0].blobs).toEqual(['create_unauthorized', '']);
  });

  it('still deletes a share with only its delete token', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    const ids = await freshIds();
    const created = await createWith(fake, `Bearer ${UPLOAD_KEY}`, { ...VALID_CREATE, ...ids });
    expect(created.status).toBe(201);

    expect((await remove(fake, ids.id, UPLOAD_KEY)).status).toBe(404);
    expect(fake.bucket.objects.has(`shares/${ids.id}`)).toBe(true);
    expect((await remove(fake, ids.id, ids.deleteToken)).status).toBe(204);
    expect(fake.bucket.objects.has(`shares/${ids.id}`)).toBe(false);
  });

  it('describes the service only to a caller with the key', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    for (const authorization of [null, `Bearer ${WRONG_KEY}`, `Basic ${UPLOAD_KEY}`]) {
      const refused = await service(fake, authorization);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: 'unauthorized' });
    }
    const response = await service(fake, `Bearer ${UPLOAD_KEY}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ service: 'spark-share', maxDays: 7, uploadKey: 'required' });
    expect(shareServiceInfoSchema.parse(body)).toEqual(body);
  });
});

describe('without an upload key', () => {
  it('creates and deletes as before and ignores an authorization header on create', async () => {
    for (const fake of [fakeEnv(), fakeEnv({ uploadKey: '' })]) {
      expect((await postJson(fake, VALID_CREATE)).status).toBe(201);
      const other = await freshIds();
      const withHeader = await createWith(fake, `Bearer ${WRONG_KEY}`, {
        ...VALID_CREATE,
        ...other,
      });
      expect(withHeader.status).toBe(201);
      expect((await remove(fake, other.id, other.deleteToken)).status).toBe(204);
    }
  });

  it('describes the service to anyone and says no key is needed', async () => {
    for (const fake of [fakeEnv(), fakeEnv({ uploadKey: '' })]) {
      const response = await service(fake);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ service: 'spark-share', maxDays: 7, uploadKey: 'none' });
      expect(shareServiceInfoSchema.parse(body)).toEqual(body);
    }
  });
});

describe('GET /v1/service', () => {
  it('answers 405 to other methods', async () => {
    const response = await call(fakeEnv(), SERVICE_PATH, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await response.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('limits each client per hour, refused requests included', async () => {
    const fake = fakeEnv({ uploadKey: UPLOAD_KEY });
    for (let index = 0; index < SERVICE_LIMIT_PER_HOUR; index++) {
      expect((await service(fake)).status).toBe(401);
    }
    const limited = await service(fake, `Bearer ${UPLOAD_KEY}`);

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect((await service(fake, `Bearer ${UPLOAD_KEY}`, '198.51.100.9')).status).toBe(200);
  });
});

describe('MAX_EXPIRY_DAYS', () => {
  it('set to 1 refuses a 7-day create, takes a 1-day one and reports 1', async () => {
    const fake = fakeEnv({ maxExpiryDays: '1' });
    const refused = await postJson(fake, VALID_CREATE);

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'invalid_request' });
    expect(fake.bucket.objects.size).toBe(0);

    const created = await create(fake, { ...VALID_CREATE, expiresInDays: 1 });
    expect(created.expiresAt).toBe(new Date(START + DAY).toISOString());

    const body = await (await service(fake)).json();
    expect(body).toEqual({ service: 'spark-share', maxDays: 1, uploadKey: 'none' });
    expect(shareServiceInfoSchema.parse(body)).toEqual(body);
  });

  it('means 7 when it is 7, unset or anything else', async () => {
    for (const value of [undefined, '7', '', '0', '2', '30', ' 1', '1.0', 'one']) {
      const fake = fakeEnv(value === undefined ? {} : { maxExpiryDays: value });

      expect((await create(fake)).expiresAt).toBe(new Date(START + 7 * DAY).toISOString());
      expect(await (await service(fake)).json()).toMatchObject({ maxDays: 7 });
    }
  });
});
