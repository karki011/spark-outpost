import { REMOTE_DEVICE_COOKIE, remoteSparkOrigin } from '@spark-outpost/contracts';

export interface JarCookie {
  name: string;
  value: string;
  domain?: string;
}

type CookieChange = (event: unknown, cookie: JarCookie, cause: string, removed: boolean) => void;

export interface DeviceCookie {
  url: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'strict';
}

export function deviceCookie(hostname: string, value: string): DeviceCookie {
  return {
    url: remoteSparkOrigin(hostname),
    name: REMOTE_DEVICE_COOKIE,
    value,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  };
}

export interface CookieJar {
  set(details: DeviceCookie): Promise<void>;
  remove(url: string, name: string): Promise<void>;
  on(event: 'changed', listener: CookieChange): unknown;
  off(event: 'changed', listener: CookieChange): unknown;
}

export interface DeviceCookieWatch {
  place(value: string): Promise<void>;
  holds(): boolean;
  forget(): Promise<void>;
  stop(): void;
}

export interface DeviceCookieEvents {
  changed(value: string): void;
  signedOut(): void;
}

function replacedByNewValue(cause: string): boolean {
  return cause === 'overwrite' || cause.startsWith('inserted');
}

export function watchDeviceCookie(
  jar: CookieJar,
  hostname: string,
  events: DeviceCookieEvents,
): DeviceCookieWatch {
  let known: string | null = null;
  const listener: CookieChange = (_event, cookie, cause, removed) => {
    if (cookie.name !== REMOTE_DEVICE_COOKIE || cookie.domain !== hostname) return;
    if (removed) {
      if (replacedByNewValue(cause) || known === null) return;
      known = null;
      events.signedOut();
      return;
    }
    if (cookie.value === '' || cookie.value === known) return;
    known = cookie.value;
    events.changed(cookie.value);
  };
  jar.on('changed', listener);
  return {
    async place(value) {
      known = value;
      await jar.set(deviceCookie(hostname, value));
    },
    holds: () => known !== null,
    async forget() {
      if (known === null) return;
      known = null;
      events.signedOut();
      await jar.remove(remoteSparkOrigin(hostname), REMOTE_DEVICE_COOKIE);
    },
    stop: () => void jar.off('changed', listener),
  };
}
