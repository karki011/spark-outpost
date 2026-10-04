import { AsyncEntry } from '@napi-rs/keyring';

export interface Keyring {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

interface KeychainCache extends Keyring {
  fresh(account: string): Promise<string | null>;
  waiting(): boolean;
}

export interface KeychainTiming {
  timeoutMs?: number;
  freshMs?: number;
  now?: () => number;
}

const KEYCHAIN_TIMEOUT_MS = 10_000;
const KEYCHAIN_FRESH_MS = 60_000;
export const KEYCHAIN_WAITING_MESSAGE =
  'Waiting for macOS keychain access — check for a prompt asking to let Spark use the keychain and click Always Allow.';

export class KeychainWaitingError extends Error {
  constructor() {
    super(KEYCHAIN_WAITING_MESSAGE);
    this.name = 'KeychainWaitingError';
  }
}

export function nativeKeyring(service: string): Keyring {
  const entry = (account: string) => new AsyncEntry(service, account);
  return {
    async get(account) {
      return (await entry(account).getPassword()) ?? null;
    },
    async set(account, secret) {
      await entry(account).setPassword(secret);
    },
    async delete(account) {
      await entry(account).deletePassword();
    },
  };
}

interface Cached {
  value: string | null;
  at: number;
}

export function keychainCache(keyring: Keyring, timing: KeychainTiming = {}): KeychainCache {
  const timeoutMs = timing.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const freshMs = timing.freshMs ?? KEYCHAIN_FRESH_MS;
  const now = timing.now ?? Date.now;
  const cache = new Map<string, Cached>();
  const reads = new Map<string, Promise<string | null>>();
  let lane: Promise<unknown> = Promise.resolve();
  let overdue = 0;

  function queued<T>(operation: () => Promise<T>): Promise<T> {
    const run = lane.then(operation, operation);
    lane = run.catch(() => undefined);
    return run;
  }

  function bounded<T>(work: Promise<T>): Promise<T> {
    let late = false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        late = true;
        overdue += 1;
        reject(new KeychainWaitingError());
      }, timeoutMs);
      timer.unref();
    });
    const settle = () => {
      clearTimeout(timer);
      if (late) overdue -= 1;
    };
    work.then(settle, settle);
    return Promise.race([work, timeout]);
  }

  function remember(account: string, value: string | null) {
    cache.set(account, { value, at: now() });
  }

  function startRead(account: string): Promise<string | null> {
    const read = queued(() => keyring.get(account)).then((value) => {
      remember(account, value);
      return value;
    });
    const forget = () => {
      if (reads.get(account) === read) reads.delete(account);
    };
    read.then(forget, forget);
    reads.set(account, read);
    return read;
  }

  function invalidate(account: string) {
    cache.delete(account);
    reads.delete(account);
  }

  return {
    fresh(account) {
      invalidate(account);
      return bounded(startRead(account));
    },
    async get(account) {
      const cached = cache.get(account);
      if (cached && now() - cached.at < freshMs) return cached.value;
      const read = reads.get(account) ?? startRead(account);
      if (cached && overdue > 0) return cached.value;
      try {
        return await bounded(read);
      } catch (error) {
        if (cached && error instanceof KeychainWaitingError) return cached.value;
        throw error;
      }
    },
    async set(account, secret) {
      invalidate(account);
      await bounded(
        queued(() => keyring.set(account, secret)).then(() => remember(account, secret)),
      );
    },
    async delete(account) {
      invalidate(account);
      await bounded(queued(() => keyring.delete(account)).then(() => remember(account, null)));
    },
    waiting() {
      return overdue > 0;
    },
  };
}
