import {
  API_TOKEN_HEADER,
  remoteAccessSchema,
  remoteDeviceListSchema,
} from '@spark-outpost/contracts';
import { fetchActiveRuns } from './active-runs.ts';

const CHECK_EVERY_MS = 30_000;
const TIMEOUT_MS = 5_000;

export interface KeepAwakeReading {
  phoneAccess: boolean;
  activeRuns: number;
  phoneConnected: boolean;
}

export interface PowerBlocker {
  start(type: 'prevent-app-suspension'): number;
  stop(id: number): void;
}

export interface KeepAwakeOptions {
  read: () => Promise<KeepAwakeReading | null>;
  blocker: PowerBlocker;
  log: (line: string) => void;
  everyMs?: number;
}

interface Schema<T> {
  safeParse(value: unknown): { data?: T };
}

export interface KeepAwake {
  dispose(): void;
}

export function needsKeepAwake(reading: KeepAwakeReading | null): boolean {
  if (!reading?.phoneAccess) return false;
  return reading.activeRuns > 0 || reading.phoneConnected;
}

async function getJson<T>(
  url: string,
  token: string,
  schema: Schema<T>,
  fetchImpl: typeof fetch,
): Promise<T | null> {
  try {
    const response = await fetchImpl(url, {
      headers: { [API_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return schema.safeParse(await response.json()).data ?? null;
  } catch {
    return null;
  }
}

export async function readKeepAwake(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeepAwakeReading | null> {
  const access = await getJson(`${origin}/api/remote/access`, token, remoteAccessSchema, fetchImpl);
  if (!access) return null;
  if (access.hostname === null) return { phoneAccess: false, activeRuns: 0, phoneConnected: false };
  const activeRuns = await fetchActiveRuns(origin, token, fetchImpl);
  if (activeRuns === null) return null;
  if (activeRuns > 0) return { phoneAccess: true, activeRuns, phoneConnected: false };
  const list = await getJson(
    `${origin}/api/remote/devices`,
    token,
    remoteDeviceListSchema,
    fetchImpl,
  );
  if (!list) return null;
  const phoneConnected = list.devices.some((device) => device.connected && !device.revokedAt);
  return { phoneAccess: true, activeRuns, phoneConnected };
}

export function startKeepAwake(options: KeepAwakeOptions): KeepAwake {
  let held: number | null = null;
  let checking = false;
  let disposed = false;
  const release = () => {
    if (held === null) return;
    options.blocker.stop(held);
    held = null;
    options.log('Released the keep-awake hold.');
  };
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const wanted = needsKeepAwake(await options.read());
      if (disposed) return;
      if (wanted && held === null) {
        held = options.blocker.start('prevent-app-suspension');
        options.log(
          'Keeping the Mac awake while phone access is on and work runs or a phone is connected.',
        );
      } else if (!wanted) release();
    } finally {
      checking = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), options.everyMs ?? CHECK_EVERY_MS);
  timer.unref();
  return {
    dispose() {
      disposed = true;
      clearInterval(timer);
      release();
    },
  };
}
