import { describe, expect, it, vi } from 'vitest';
import { ALL_CREATE_BYTES_PER_DAY, ALL_CREATES_PER_HOUR, CREATE_LIMIT_PER_HOUR } from './api.ts';
import { LOCK_AFTER, LOCK_MS, SHARE_ATTEMPTS_PER_HOUR } from './counters.ts';
import {
  call,
  create,
  fakeEnv,
  freshIds,
  ORIGIN,
  postJson,
  START,
  VALID_CREATE,
  type FakeEnv,
} from './test-fakes.ts';

const CODE = 'ABCD2345';
const WRONG = 'WXYZ6789';
const HOUR = 3_600_000;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function createFrom(fake: FakeEnv, ip: string, now = START) {
  return postJson(fake, { ...VALID_CREATE, ...(await freshIds()) }, { ip, now });
}

function unlockFrom(fake: FakeEnv, id: string, code: string, ip: string, now = START) {
  return call(
    fake,
    `/a/${id}/unlock`,
    { method: 'POST', headers: FORM, body: `code=${code}`, ip },
    now,
  );
}

function fillWindow(fake: FakeEnv, name: string, count: number) {
  fake.storages.get(name)!.values.set('window', { start: START, count });
}

describe('create limits', () => {
  it('counts every address of one IPv6 /64 as one client', async () => {
    const fake = fakeEnv();
    for (let index = 0; index < CREATE_LIMIT_PER_HOUR; index++) {
      expect((await createFrom(fake, `2001:db8:1:2::${index + 1}`)).status).toBe(201);
    }
    expect((await createFrom(fake, '2001:db8:1:2:ffff::9')).status).toBe(429);
    expect((await createFrom(fake, '2001:db8:1:3::1')).status).toBe(201);
  });

  it('stops every client once all creates in an hour reach the cap', async () => {
    const fake = fakeEnv();
    await create(fake);
    fillWindow(fake, 'rate:create:all', ALL_CREATES_PER_HOUR);
    const refused = await createFrom(fake, '198.51.100.4');

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'rate_limited' });
    expect((await createFrom(fake, '198.51.100.4', START + HOUR)).status).toBe(201);
  });

  it('stops creates that would pass the daily byte cap and still takes smaller ones', async () => {
    const fake = fakeEnv();
    await create(fake);
    fillWindow(fake, 'rate:create:bytes', ALL_CREATE_BYTES_PER_DAY - 100);
    const big = { ...VALID_CREATE, ...(await freshIds()), html: 'x'.repeat(101) };
    const small = { ...VALID_CREATE, ...(await freshIds()), html: 'x'.repeat(100) };

    expect((await postJson(fake, big)).status).toBe(429);
    expect(fake.bucket.objects.has(`shares/${String(big.id)}`)).toBe(false);
    expect((await postJson(fake, small)).status).toBe(201);
    expect((await postJson(fake, big, { now: START + 24 * HOUR })).status).toBe(201);
  });

  it('spends none of the shared cap on a request that is refused as invalid', async () => {
    const fake = fakeEnv();
    await create(fake);
    const before = fake.storages.get('rate:create:all')!.values.get('window');
    expect((await postJson(fake, { ...VALID_CREATE, id: 'A'.repeat(22) })).status).toBe(400);
    expect(fake.storages.get('rate:create:all')!.values.get('window')).toEqual(before);
  });

  it('writes nothing more for a client already over its own limit', async () => {
    const fake = fakeEnv();
    for (let index = 0; index < CREATE_LIMIT_PER_HOUR; index++) await create(fake);
    const storage = fake.storages.get('rate:create:203.0.113.7')!;
    const before = structuredClone(storage.values.get('window'));
    expect((await postJson(fake, VALID_CREATE)).status).toBe(429);
    expect(storage.values.get('window')).toEqual(before);
  });
});

describe('passcode attempt limits', () => {
  async function lockedShare(fake: FakeEnv) {
    return (await create(fake, { ...VALID_CREATE, passcode: CODE })).id;
  }

  it('locks out the visitor who guessed wrong and nobody else', async () => {
    const fake = fakeEnv();
    const id = await lockedShare(fake);
    for (let index = 0; index < LOCK_AFTER; index++) {
      expect((await unlockFrom(fake, id, WRONG, '198.51.100.4')).status).toBe(401);
    }

    expect((await unlockFrom(fake, id, CODE, '198.51.100.4')).status).toBe(429);
    expect((await call(fake, `/a/${id}`, { ip: '198.51.100.4' })).status).toBe(429);
    expect((await call(fake, `/a/${id}`)).status).toBe(200);
    expect((await unlockFrom(fake, id, CODE, '203.0.113.7')).status).toBe(200);
  });

  it('counts the addresses of one IPv6 /64 as one visitor', async () => {
    const fake = fakeEnv();
    const id = await lockedShare(fake);
    for (let index = 0; index < LOCK_AFTER; index++) {
      await unlockFrom(fake, id, WRONG, `2001:db8:9:9::${index + 1}`);
    }
    expect((await unlockFrom(fake, id, CODE, '2001:db8:9:9:abcd::1')).status).toBe(429);
  });

  it('checks at most 50 codes an hour for one share however many visitors try', async () => {
    const fake = fakeEnv();
    const id = await lockedShare(fake);
    for (let index = 0; index < SHARE_ATTEMPTS_PER_HOUR; index++) {
      expect((await unlockFrom(fake, id, WRONG, `198.51.100.${index + 1}`)).status).toBe(401);
    }
    const capped = await unlockFrom(fake, id, CODE, '192.0.2.200');

    expect(capped.status).toBe(429);
    expect(await capped.text()).toContain('Try again in about 60 minutes');
    expect((await call(fake, `/a/${id}`, { ip: '192.0.2.200' })).status).toBe(429);
    expect((await unlockFrom(fake, id, CODE, '192.0.2.200', START + HOUR)).status).toBe(200);
  });

  it('spends none of the hourly share budget on correct codes', async () => {
    const fake = fakeEnv();
    const id = await lockedShare(fake);
    for (let index = 0; index < SHARE_ATTEMPTS_PER_HOUR + 10; index++) {
      expect((await unlockFrom(fake, id, CODE, `198.51.100.${index + 1}`)).status).toBe(200);
    }
    expect((await unlockFrom(fake, id, WRONG, '192.0.2.200')).status).toBe(401);
  });

  it('keeps a share’s counts while its hour or a lock can still run, then clears them', async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeEnv();
      const id = await lockedShare(fake);
      await unlockFrom(fake, id, WRONG, '198.51.100.1');
      const storage = fake.storages.get(`attempts:${id}`)!;
      const keepUntil = START + HOUR + LOCK_MS;
      expect(storage.alarm).toBe(keepUntil);

      storage.alarm = null;
      vi.setSystemTime(keepUntil - 1);
      await fake.alarm(`attempts:${id}`);
      expect(storage.alarm).toBe(keepUntil);
      expect(storage.values.size).toBeGreaterThan(0);

      vi.setSystemTime(keepUntil);
      await fake.alarm(`attempts:${id}`);
      expect(storage.values.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reports', () => {
  function reportWith(
    fake: FakeEnv,
    id: string,
    headers: Record<string, string>,
    site: string | null,
  ) {
    return call(fake, `/a/${id}/report`, {
      method: 'POST',
      headers: { ...FORM, ...headers },
      body: 'reason=x',
      site,
    });
  }

  it('takes a report only from the worker’s own pages', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);

    expect((await reportWith(fake, id, {}, 'same-origin')).status).toBe(200);
    expect((await reportWith(fake, id, { origin: ORIGIN }, null)).status).toBe(200);
    expect((await reportWith(fake, id, { origin: ORIGIN }, 'cross-site')).status).toBe(400);
    expect((await reportWith(fake, id, {}, 'same-site')).status).toBe(400);
    expect((await reportWith(fake, id, { origin: 'https://evil.example' }, null)).status).toBe(400);
    expect((await reportWith(fake, id, { origin: 'null' }, null)).status).toBe(400);
    expect((await reportWith(fake, id, {}, null)).status).toBe(400);
    const stored = [...fake.bucket.objects.keys()].filter((key) => key.startsWith('reports/'));
    expect(stored).toHaveLength(2);
  });

  it('counts none of a refused cross-site report against the visitor', async () => {
    const fake = fakeEnv();
    const { id } = await create(fake);
    await reportWith(fake, id, {}, 'cross-site');
    expect(fake.storages.has('rate:report:203.0.113.7')).toBe(false);
  });
});
