import { beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_DEVICE_COOKIE } from '@spark-outpost/contracts';
import { watchDeviceCookie, type DeviceCookieWatch } from './cookie.ts';
import { FakeCookies } from './electron.fixture.ts';

const HOST = 'studio.tail1234.ts.net';

let jar: FakeCookies;
let seen: string[];
let watch: DeviceCookieWatch;

beforeEach(() => {
  jar = new FakeCookies();
  seen = [];
  watch = watchDeviceCookie(jar, HOST, {
    changed: (value) => seen.push(`cookie:${value}`),
    signedOut: () => seen.push('signed-out'),
  });
});

describe('the device cookie of a remote Spark window', () => {
  it('is placed as a host-only, secure, http-only cookie and not reported back', async () => {
    await watch.place('saved-value');
    expect(jar.placed).toEqual([
      {
        url: `https://${HOST}`,
        name: REMOTE_DEVICE_COOKIE,
        value: 'saved-value',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    ]);
    expect(seen).toEqual([]);
  });

  it('is captured when the host sets it', () => {
    jar.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'first');
    expect(seen).toEqual(['cookie:first']);
  });

  it('reports a replaced value once and no sign-out for the overwrite', async () => {
    await watch.place('saved-value');
    jar.hostReplaces(REMOTE_DEVICE_COOKIE, HOST, 'saved-value', 'second');
    jar.hostReplaces(REMOTE_DEVICE_COOKIE, HOST, 'second', 'second');
    expect(seen).toEqual(['cookie:second']);
  });

  it('ignores another cookie name and another host', () => {
    jar.hostSets('__Host-spark_passkey', HOST, 'ticket');
    jar.hostSets(REMOTE_DEVICE_COOKIE, 'other.tail1234.ts.net', 'theirs');
    jar.hostSets(REMOTE_DEVICE_COOKIE, `.${HOST}`, 'wide');
    jar.hostRemoves(REMOTE_DEVICE_COOKIE, 'other.tail1234.ts.net', 'theirs');
    expect(seen).toEqual([]);
  });

  it('reports a sign-out when the host removes it', async () => {
    await watch.place('saved-value');
    jar.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'saved-value');
    jar.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'saved-value');
    expect(seen).toEqual(['signed-out']);
  });

  it('reports nothing after it stops', () => {
    watch.stop();
    jar.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'late');
    jar.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'late');
    expect(seen).toEqual([]);
  });
});
