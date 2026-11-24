import type { RemoteHost } from '@spark-outpost/contracts';

const STORE_KEY = 'spark-outpost.remote-client';
const HOST_KEY = 'spark-outpost.remote-host';

let known: boolean | null = null;
let knownHost: RemoteHost | null = null;

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rememberRemoteClient(remote: boolean, host?: RemoteHost): void {
  known = remote;
  store(STORE_KEY, remote ? '1' : '0');
  if (!host) return;
  knownHost = host;
  store(HOST_KEY, host);
}

export function rememberedRemoteClient(): boolean {
  if (known !== null) return known;
  return stored(STORE_KEY) === '1';
}

export function rememberedRemoteHost(): RemoteHost | null {
  if (knownHost !== null) return knownHost;
  const value = stored(HOST_KEY);
  return value === 'mac' || value === 'windows' ? value : null;
}
