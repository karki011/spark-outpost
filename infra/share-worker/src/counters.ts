import type { CounterNamespace } from './env.ts';

export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

export interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
}

export interface CounterState {
  storage: CounterStorage;
}

type CounterOp =
  | { op: 'hit'; now: number; limit: number; windowMs: number }
  | { op: 'check'; now: number }
  | { op: 'attempt'; now: number }
  | { op: 'pass' }
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
    await this.storage.deleteAll();
  }

  private async apply(op: CounterOp): Promise<unknown> {
    switch (op.op) {
      case 'hit':
        return this.hit(op.now, op.limit, op.windowMs);
      case 'check':
        return this.check(op.now);
      case 'attempt':
        return this.attempt(op.now);
      case 'pass':
        await this.storage.deleteAll();
        return {};
      case 'clear':
        await this.storage.deleteAll();
        return {};
    }
  }

  private async hit(now: number, limit: number, windowMs: number) {
    let window = await this.storage.get<RateWindow>('window');
    if (!window || now >= window.start + windowMs) {
      window = { start: now, count: 0 };
      await this.storage.setAlarm(now + windowMs);
    }
    window.count += 1;
    await this.storage.put('window', window);
    return { allowed: window.count <= limit };
  }

  private async attempts(): Promise<Attempts> {
    const stored = await this.storage.get<Attempts>('attempts');
    return { run: stored?.run ?? 0, lockedUntil: stored?.lockedUntil ?? 0 };
  }

  private async check(now: number): Promise<AttemptState> {
    const { lockedUntil } = await this.attempts();
    return { lockedUntil: lockedUntil > now ? lockedUntil : 0 };
  }

  private async attempt(now: number): Promise<Reservation> {
    const attempts = await this.attempts();
    if (attempts.lockedUntil > now) return { allowed: false, lockedUntil: attempts.lockedUntil };
    attempts.run += 1;
    attempts.lockedUntil = 0;
    if (attempts.run >= LOCK_AFTER) {
      attempts.run = 0;
      attempts.lockedUntil = now + LOCK_MS;
    }
    await this.storage.put('attempts', attempts);
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

export async function allowHit(
  namespace: CounterNamespace,
  name: string,
  now: number,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const result = await call<{ allowed: boolean }>(namespace, `rate:${name}`, {
    op: 'hit',
    now,
    limit,
    windowMs,
  });
  return result.allowed;
}

export function checkAttempts(namespace: CounterNamespace, id: string, now: number) {
  return call<AttemptState>(namespace, `attempts:${id}`, { op: 'check', now });
}

export function reserveAttempt(namespace: CounterNamespace, id: string, now: number) {
  return call<Reservation>(namespace, `attempts:${id}`, { op: 'attempt', now });
}

export async function recordRightCode(namespace: CounterNamespace, id: string) {
  await call(namespace, `attempts:${id}`, { op: 'pass' });
}

export async function clearAttempts(namespace: CounterNamespace, id: string) {
  await call(namespace, `attempts:${id}`, { op: 'clear' });
}
