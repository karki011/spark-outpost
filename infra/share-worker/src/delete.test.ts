import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FINAL_HEADER, RETIRE_LIMIT_PER_HOUR } from './api.ts';
import {
  call,
  create,
  fakeEnv,
  freshIds,
  postJson,
  remove,
  START,
  VALID_CREATE,
} from './test-fakes.ts';

const DAY = 86_400_000;

describe('DELETE /v1/shares/:id', () => {
  it('deletes with the right token and then answers 404', async () => {
    const fake = fakeEnv();
    const created = await create(fake);

    expect((await remove(fake, created.id, created.deleteToken)).status).toBe(204);
    expect([...fake.bucket.objects.keys()]).toEqual([`gone/${created.id}`]);
    expect(fake.bucket.objects.get(`gone/${created.id}`)?.value).toBe('');
    const again = await remove(fake, created.id, created.deleteToken);
    expect(again.status).toBe(404);
    expect(again.headers.get(FINAL_HEADER)).toBe('1');
    expect((await call(fake, `/a/${created.id}`)).status).toBe(404);
  });

  it('answers 404 for a wrong or missing token and keeps the share', async () => {
    const fake = fakeEnv();
    const created = await create(fake);
    const other = await create(fake);

    const wrong = await remove(fake, created.id, other.deleteToken);
    expect(wrong.status).toBe(404);
    expect(wrong.headers.get(FINAL_HEADER)).toBeNull();
    expect(await wrong.json()).toEqual({ error: 'not_found' });
    const anonymous = await remove(fake, created.id, null);
    expect(anonymous.status).toBe(404);
    expect(anonymous.headers.get(FINAL_HEADER)).toBeNull();
    expect((await remove(fake, 'A'.repeat(22), created.deleteToken)).status).toBe(404);
    expect(fake.bucket.objects.has(`shares/${created.id}`)).toBe(true);
    expect(fake.bucket.objects.has(`gone/${created.id}`)).toBe(false);
    expect((await call(fake, `/a/${created.id}`)).status).toBe(200);
  });

  it('deletes a page that was stored between its lookup and the retiring of its id', async () => {
    const fake = fakeEnv();
    const put = fake.bucket.put.bind(fake.bucket);
    fake.bucket.put = async (key, value, options) => {
      if (key === `gone/${VALID_CREATE.id}`) await postJson(fake, VALID_CREATE);
      return put(key, value, options);
    };

    const response = await remove(
      fake,
      VALID_CREATE.id as string,
      VALID_CREATE.deleteToken as string,
    );
    expect(response.status).toBe(204);
    expect([...fake.bucket.objects.keys()]).toEqual([`gone/${VALID_CREATE.id}`]);
  });

  it('retires an id with nothing stored only for the token that gives it', async () => {
    const fake = fakeEnv();
    const { id, deleteToken } = await freshIds();
    const other = await freshIds();

    const anonymous = await remove(fake, id, null);
    expect(anonymous.status).toBe(404);
    expect(anonymous.headers.get(FINAL_HEADER)).toBeNull();
    expect((await remove(fake, id, other.deleteToken)).status).toBe(404);
    expect((await remove(fake, 'A'.repeat(30), deleteToken)).status).toBe(404);
    expect(fake.bucket.objects.size).toBe(0);

    const owned = await remove(fake, id, deleteToken);
    expect(owned.status).toBe(404);
    expect(owned.headers.get(FINAL_HEADER)).toBe('1');
    expect([...fake.bucket.objects.keys()]).toEqual([`gone/${id}`]);
  });

  it('says a 404 is final when the key in the request can never store a page there', async () => {
    const fake = fakeEnv();
    const { id } = await freshIds();
    const other = await freshIds();

    const missing = await remove(fake, id, other.deleteToken);
    expect(missing.status).toBe(404);
    expect(missing.headers.get(FINAL_HEADER)).toBe('1');
    expect(fake.bucket.objects.size).toBe(0);
    expect(
      (await postJson(fake, { ...VALID_CREATE, id, deleteToken: other.deleteToken })).status,
    ).toBe(400);
  });

  it('retires 60 unstored ids per hour per address, then answers 429 and writes nothing', async () => {
    const fake = fakeEnv();
    for (let index = 0; index < RETIRE_LIMIT_PER_HOUR; index++) {
      const { id, deleteToken } = await freshIds();
      expect((await remove(fake, id, deleteToken)).status).toBe(404);
    }
    expect(fake.bucket.objects.size).toBe(RETIRE_LIMIT_PER_HOUR);

    const { id, deleteToken } = await freshIds();
    const limited = await remove(fake, id, deleteToken);
    expect(limited.status).toBe(429);
    expect(limited.headers.get(FINAL_HEADER)).toBeNull();
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(fake.bucket.objects.size).toBe(RETIRE_LIMIT_PER_HOUR);
    expect((await postJson(fake, { ...VALID_CREATE, id, deleteToken })).status).toBe(201);
    expect((await remove(fake, id, deleteToken)).status).toBe(204);

    const elsewhere = await call(fake, `/v1/shares/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${deleteToken}` },
      ip: '198.51.100.9',
    });
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.headers.get(FINAL_HEADER)).toBe('1');
    const later = await freshIds();
    expect((await remove(fake, later.id, later.deleteToken, START + 3_600_000)).status).toBe(404);
    expect(fake.bucket.objects.has(`gone/${later.id}`)).toBe(true);
  });

  it('does not count a repeat for an id already retired, or a stored share, against the limit', async () => {
    const fake = fakeEnv();
    const first = await freshIds();
    for (let index = 0; index < RETIRE_LIMIT_PER_HOUR + 5; index++) {
      const repeat = await remove(fake, first.id, first.deleteToken);
      expect(repeat.status).toBe(404);
      expect(repeat.headers.get(FINAL_HEADER)).toBe('1');
    }
    for (let index = 1; index < RETIRE_LIMIT_PER_HOUR; index++) {
      const { id, deleteToken } = await freshIds();
      expect((await remove(fake, id, deleteToken)).status).toBe(404);
    }
    const over = await freshIds();
    expect((await remove(fake, over.id, over.deleteToken)).status).toBe(429);

    const stored = await create(fake);
    expect((await remove(fake, stored.id, stored.deleteToken)).status).toBe(204);
    expect(fake.bucket.objects.has(`gone/${stored.id}`)).toBe(true);
  });

  it('deletes a share stored before ids came from tokens by its stored token hash', async () => {
    const fake = fakeEnv();
    const id = 'Ab3_-Ab3_-Ab3_-Ab3_-Ab';
    const deleteToken = 'L'.repeat(43);
    await fake.bucket.put(`shares/${id}`, '<h1>Old</h1>', {
      customMetadata: {
        title: 'Old',
        createdAt: new Date(START - DAY).toISOString(),
        expiresAt: new Date(START + DAY).toISOString(),
        deleteTokenHash: createHash('sha256').update(deleteToken).digest('base64url'),
      },
    });

    expect((await call(fake, `/a/${id}`)).status).toBe(200);
    expect((await postJson(fake, { ...VALID_CREATE, id, deleteToken })).status).toBe(400);
    expect((await remove(fake, id, VALID_CREATE.deleteToken as string)).status).toBe(404);
    expect(fake.bucket.objects.has(`shares/${id}`)).toBe(true);
    expect((await remove(fake, id, deleteToken)).status).toBe(204);
    expect(fake.bucket.objects.has(`shares/${id}`)).toBe(false);
    expect((await call(fake, `/a/${id}`)).status).toBe(404);
    expect((await postJson(fake, { ...VALID_CREATE, id, deleteToken })).status).toBe(400);
  });

  it('answers a final 404 for a legacy id with nothing stored and writes nothing', async () => {
    const fake = fakeEnv();
    const response = await remove(fake, 'Ab3_-Ab3_-Ab3_-Ab3_-Ab', 'L'.repeat(43));
    expect(response.status).toBe(404);
    expect(response.headers.get(FINAL_HEADER)).toBe('1');
    expect(fake.bucket.objects.size).toBe(0);
  });

  it('only accepts DELETE', async () => {
    const fake = fakeEnv();
    const created = await create(fake);
    const response = await call(fake, `/v1/shares/${created.id}`, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('DELETE');
  });
});
