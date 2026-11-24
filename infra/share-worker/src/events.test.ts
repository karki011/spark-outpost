import { describe, expect, it, vi } from 'vitest';
import { CREATE_LIMIT_PER_HOUR } from './api.ts';
import { LOCK_AFTER } from './counters.ts';
import type { EventPoint } from './events.ts';
import {
  call,
  cookieFrom,
  create,
  fakeEnv,
  frameSrc,
  postForm,
  postJson,
  remove,
  START,
  VALID_CREATE,
} from './test-fakes.ts';
import worker from './worker.ts';

const CODE = 'ABCD2345';
const ADDRESS = '203.0.113.7';

function recording() {
  const points: EventPoint[] = [];
  const fake = fakeEnv({ events: { writeDataPoint: (point) => void points.push(point) } });
  const names = () => points.map((point) => point.blobs[0]);
  return { fake, points, names };
}

async function runCron(fake: ReturnType<typeof fakeEnv>, now: number) {
  const waited: Promise<unknown>[] = [];
  vi.spyOn(Date, 'now').mockReturnValue(now);
  worker.scheduled(undefined, fake.env, { waitUntil: (promise) => waited.push(promise) });
  await Promise.all(waited);
  vi.restoreAllMocks();
}

describe('aggregate events', () => {
  it('records one named point for each thing that happens to a share', async () => {
    const { fake, points, names } = recording();
    const open = await create(fake);
    const locked = await create(fake, { ...VALID_CREATE, passcode: CODE });
    const shell = await (await call(fake, `/a/${open.id}`)).text();
    await call(fake, frameSrc(shell));
    await postForm(fake, `/a/${locked.id}/unlock`, { code: 'WXYZ6789' });
    const unlocked = await postForm(fake, `/a/${locked.id}/unlock`, { code: CODE });
    const cookie = cookieFrom(unlocked);
    const lockedShell = await (await call(fake, `/a/${locked.id}`, { headers: { cookie } })).text();
    await call(fake, frameSrc(lockedShell), { headers: { cookie } });
    await postForm(fake, `/a/${open.id}/report`, { reason: 'spam' });
    await remove(fake, open.id, open.deleteToken);
    await runCron(fake, START + 8 * 86_400_000);

    expect(names()).toEqual([
      'share_created',
      'share_created',
      'share_viewed',
      'unlock_wrong',
      'unlock_ok',
      'share_viewed',
      'report_filed',
      'share_deleted',
      'share_expired',
    ]);
    expect(points[0]).toEqual({
      indexes: ['share-worker'],
      blobs: ['share_created', 'open'],
      doubles: [new TextEncoder().encode(String(VALID_CREATE.html)).byteLength],
    });
    expect(points[1]!.blobs).toEqual(['share_created', 'passcode']);
    expect(points.at(-1)).toEqual({
      indexes: ['share-worker'],
      blobs: ['share_expired', ''],
      doubles: [1],
    });
  });

  it('records refused creates and locked unlocks', async () => {
    const { fake, names } = recording();
    await postJson(fake, { ...VALID_CREATE, id: 'A'.repeat(22) });
    await postJson(fake, 'not json');
    const { id } = await create(fake, { ...VALID_CREATE, passcode: CODE });
    for (let index = 0; index <= LOCK_AFTER; index++) {
      await postForm(fake, `/a/${id}/unlock`, { code: 'WXYZ6789' });
    }
    fake.storages.get(`rate:create:${ADDRESS}`)!.values.set('window', {
      start: START,
      count: CREATE_LIMIT_PER_HOUR,
    });
    await postJson(fake, VALID_CREATE);
    fake.storages.get('rate:create:all')!.values.set('window', { start: START, count: 1e9 });
    await postJson(fake, VALID_CREATE, { ip: '198.51.100.4' });

    expect(names()).toEqual([
      'create_rejected',
      'create_rejected',
      'share_created',
      ...new Array<string>(LOCK_AFTER).fill('unlock_wrong'),
      'unlock_locked',
      'create_rate_limited',
      'create_global_limited',
    ]);
  });

  it('never writes an id, a title, a code, a token or an address', async () => {
    const { fake, points } = recording();
    const made = await create(fake, { ...VALID_CREATE, passcode: CODE });
    await postForm(fake, `/a/${made.id}/unlock`, { code: CODE });
    await postForm(fake, `/a/${made.id}/report`, { reason: 'private reason' });
    await remove(fake, made.id, made.deleteToken);
    const written = JSON.stringify(points);

    for (const secret of [
      made.id,
      made.deleteToken,
      CODE,
      ADDRESS,
      String(VALID_CREATE.title),
      'private reason',
      'share.example',
    ]) {
      expect(written).not.toContain(secret);
    }
    for (const point of points) {
      expect(point.indexes).toEqual(['share-worker']);
      expect(point.blobs).toHaveLength(2);
      expect(point.doubles).toHaveLength(1);
    }
  });

  it('answers as usual when no dataset is bound or a write throws', async () => {
    const unbound = fakeEnv();
    expect((await postJson(unbound, VALID_CREATE)).status).toBe(201);
    const failing = fakeEnv({
      events: {
        writeDataPoint: () => {
          throw new Error('dataset unavailable');
        },
      },
    });
    expect((await postJson(failing, VALID_CREATE)).status).toBe(201);
    await expect(runCron(failing, START + 8 * 86_400_000)).resolves.toBeUndefined();
  });
});
