import type { CounterNamespace } from './env.ts';

export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;
export const SHARE_ATTEMPTS_PER_HOUR = 50;
const HOUR_MS = 3_600_000;
const SHARE_WINDOW = 'share-window';
const clientAttempts = (client: string) => `attempts:${client}`;

export interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
}

export interface CounterState {
  storage: CounterStorage;
}

type CounterOp =
  | { op: 'hit'; now: number; limit: number; windowMs: number; amount: number }
  | { op: 'check'; now: number; client: string }
  | { op: 'attempt'; now: number; client: string }
  | { op: 'pass'; client: string }
  | { op: 'clear' };

interface RateWindow {
  start: number;
  count: number;
}

interface Attempts {
  run: number;
  lockedUntil: number;
}

export interface AttemptState {
  lockedUntil: number;
}

export interface Reservation {
  allowed: boolean;
  lockedUntil: number;
}

export class ShareCounters {
  private readonly storage: CounterStorage;

  constructor(state: CounterState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    return Response.json(await this.apply((await request.json()) as CounterOp));
  }

  async alarm(): Promise<void> {
    const window = await this.storage.get<RateWindow>(SHARE_WINDOW);
    const keepUntil = window ? window.start + HOUR_MS + LOCK_MS : 0;
    if (Date.now() < keepUntil) await this.storage.setAlarm(keepUntil);
    else await this.storage.deleteAll();
  }

  private async apply(op: CounterOp): Promise<unknown> {
    switch (op.op) {
      case 'hit':
        return this.hit(op.now, op.limit, op.windowMs, op.amount);
      case 'check':
        return this.check(op.now, op.client);
      case 'attempt':
        return this.attempt(op.now, op.client);
      case 'pass':
        await this.pass(op.client);
        return {};
      case 'clear':
        await this.storage.deleteAll();
        return {};
    }
  }

  private async hit(now: number, limit: number, windowMs: number, amount: number) {
    let window = await this.storage.get<RateWindow>('window');
    if (!window || now >= window.start + windowMs) {
      window = { start: now, count: 0 };
      await this.storage.setAlarm(now + windowMs);
    }
    if (window.count + amount > limit) return { allowed: false };
    window.count += amount;
    await this.storage.put('window', window);
    return { allowed: true };
  }

  private async pass(client: string): Promise<void> {
    await this.storage.delete(clientAttempts(client));
    const window = await this.storage.get<RateWindow>(SHARE_WINDOW);
    if (!window || window.count === 0) return;
    await this.storage.put(SHARE_WINDOW, { ...window, count: window.count - 1 });
  }

  private async attempts(client: string): Promise<Attempts> {
    const stored = await this.storage.get<Attempts>(clientAttempts(client));
    return { run: stored?.run ?? 0, lockedUntil: stored?.lockedUntil ?? 0 };
  }

  private async shareWindow(now: number): Promise<RateWindow> {
    const stored = await this.storage.get<RateWindow>(SHARE_WINDOW);
    return stored && now < stored.start + HOUR_MS ? stored : { start: now, count: 0 };
  }

  private async lockedUntil(now: number, client: string): Promise<number> {
    const { lockedUntil } = await this.attempts(client);
    if (lockedUntil > now) return lockedUntil;
    const window = await this.shareWindow(now);
    return window.count >= SHARE_ATTEMPTS_PER_HOUR ? window.start + HOUR_MS : 0;
  }

  private async check(now: number, client: string): Promise<AttemptState> {
    return { lockedUntil: await this.lockedUntil(now, client) };
  }

  private async attempt(now: number, client: string): Promise<Reservation> {
    const lockedUntil = await this.lockedUntil(now, client);
    if (lockedUntil) return { allowed: false, lockedUntil };
    const window = await this.shareWindow(now);
    if (window.count === 0) await this.storage.setAlarm(window.start + HOUR_MS + LOCK_MS);
    window.count += 1;
    await this.storage.put(SHARE_WINDOW, window);
    const attempts = await this.attempts(client);
    attempts.run += 1;
    attempts.lockedUntil = 0;
    if (attempts.run >= LOCK_AFTER) {
      attempts.run = 0;
      attempts.lockedUntil = now + LOCK_MS;
    }
    await this.storage.put(clientAttempts(client), attempts);
    return { allowed: true, lockedUntil: attempts.lockedUntil };
  }
}

async function call<T>(namespace: CounterNamespace, name: string, op: CounterOp): Promise<T> {
  const stub = namespace.get(namespace.idFromName(name));
  const response = await stub.fetch(
    new Request('https://counters.internal/', { method: 'POST', body: JSON.stringify(op) }),
  );
  return (await response.json()) as T;
}

export interface RateLimit {
  name: string;
  limit: number;
  windowMs: number;
  amount?: number;
}

export async function allowHit(
  namespace: CounterNamespace,
  rate: RateLimit,
  now: number,
): Promise<boolean> {
  const result = await call<{ allowed: boolean }>(namespace, `rate:${rate.name}`, {
    op: 'hit',
    now,
    limit: rate.limit,
    windowMs: rate.windowMs,
    amount: rate.amount ?? 1,
  });
  return result.allowed;
}

export function checkAttempts(
  namespace: CounterNamespace,
  id: string,
  client: string,
  now: number,
) {
  return call<AttemptState>(namespace, `attempts:${id}`, { op: 'check', now, client });
}

export function reserveAttempt(
  namespace: CounterNamespace,
  id: string,
  client: string,
  now: number,
) {
  return call<Reservation>(namespace, `attempts:${id}`, { op: 'attempt', now, client });
}

export async function recordRightCode(namespace: CounterNamespace, id: string, client: string) {
  await call(namespace, `attempts:${id}`, { op: 'pass', client });
}

export async function clearAttempts(namespace: CounterNamespace, id: string) {
  await call(namespace, `attempts:${id}`, { op: 'clear' });
}
