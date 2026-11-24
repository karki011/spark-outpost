import { ShareCounters, type CounterStorage } from './counters.ts';
import { randomToken, shareIdFor } from './crypto.ts';
import type { EventDataset } from './events.ts';
import type {
  ListOptions,
  PutOptions,
  ShareBucket,
  ShareEnv,
  StoredObject,
  StoredObjectBody,
} from './env.ts';
import { handleRequest } from './worker.ts';

export const ORIGIN = 'https://share.example';
export const SIGNING_KEY = 'k'.repeat(48);
export const START = Date.parse('2026-11-17T12:00:00.000Z');

interface FakeObject {
  value: string;
  options: PutOptions;
}

class FakeBucket implements ShareBucket {
  readonly objects = new Map<string, FakeObject>();
  readonly reads: string[] = [];

  constructor(private readonly pageSize: number) {}

  private view(key: string, object: FakeObject): StoredObjectBody {
    return {
      key,
      customMetadata: { ...object.options.customMetadata },
      text: async () => object.value,
    };
  }

  async head(key: string) {
    this.reads.push(`head ${key}`);
    const object = this.objects.get(key);
    return object ? this.view(key, object) : null;
  }

  async get(key: string) {
    this.reads.push(`get ${key}`);
    const object = this.objects.get(key);
    return object ? this.view(key, object) : null;
  }

  async put(key: string, value: string | Uint8Array, options: PutOptions = {}) {
    if (options.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
    const object = { value: text, options };
    this.objects.set(key, object);
    return this.view(key, object);
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options: ListOptions) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    const after = options.cursor;
    const remaining = after === undefined ? keys : keys.filter((key) => key > after);
    const page = remaining.slice(0, this.pageSize);
    const objects: StoredObject[] = page.map((key) => {
      const metadata = this.objects.get(key)!.options.customMetadata;
      return options.include?.includes('customMetadata') && metadata
        ? { key, customMetadata: { ...metadata } }
        : { key };
    });
    return remaining.length > page.length
      ? { objects, truncated: true, cursor: page[page.length - 1]! }
      : { objects, truncated: false };
  }
}

class FakeStorage implements CounterStorage {
  readonly values = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  async put(key: string, value: unknown) {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string) {
    return this.values.delete(key);
  }

  async deleteAll() {
    this.values.clear();
  }

  async setAlarm(time: number) {
    this.alarm = time;
  }
}

export function fakeEnv(
  options: { signingKey?: string | null; pageSize?: number; events?: EventDataset } = {},
) {
  const bucket = new FakeBucket(options.pageSize ?? 1000);
  const storages = new Map<string, FakeStorage>();
  const counters = new Map<string, ShareCounters>();
  const queues = new Map<string, Promise<unknown>>();
  const signingKey = options.signingKey === undefined ? SIGNING_KEY : options.signingKey;
  const env: ShareEnv = {
    SHARES: bucket,
    COUNTERS: {
      idFromName: (name) => name,
      get: (id) => {
        const name = String(id);
        if (!counters.has(name)) {
          const storage = new FakeStorage();
          storages.set(name, storage);
          counters.set(name, new ShareCounters({ storage }));
        }
        const counter = counters.get(name)!;
        return {
          fetch: (request) => {
            const turn = (queues.get(name) ?? Promise.resolve()).then(() => counter.fetch(request));
            queues.set(
              name,
              turn.catch(() => undefined),
            );
            return turn;
          },
        };
      },
    },
    ...(signingKey === null ? {} : { SIGNING_KEY: signingKey }),
    ...(options.events ? { EVENTS: options.events } : {}),
  };
  const alarm = async (name: string) => counters.get(name)?.alarm();
  return { env, bucket, storages, alarm };
}

export type FakeEnv = ReturnType<typeof fakeEnv>;

export interface CreateBody {
  id?: unknown;
  deleteToken?: unknown;
  title?: unknown;
  html?: unknown;
  expiresInDays?: unknown;
  passcode?: unknown;
  [key: string]: unknown;
}

export const VALID_CREATE: CreateBody = {
  id: 'D65s4UWzkH75nfvCxUTMnw',
  deleteToken: 'Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4_-Tk4',
  title: 'Quarterly plan',
  html: '<!doctype html><h1>Plan</h1><script>document.title = "x"</script>',
  expiresInDays: 7,
};

export function call(
  fake: FakeEnv,
  path: string,
  init: RequestInit & { ip?: string; site?: string | null } = {},
  now = START,
) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', init.ip ?? '203.0.113.7');
  if (init.site !== null) headers.set('sec-fetch-site', init.site ?? 'same-origin');
  return handleRequest(new Request(`${ORIGIN}${path}`, { ...init, headers }), fake.env, now);
}

export function postJson(
  fake: FakeEnv,
  body: unknown,
  options: { ip?: string; now?: number } = {},
) {
  return call(
    fake,
    '/v1/shares',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...(options.ip ? { ip: options.ip } : {}),
    },
    options.now ?? START,
  );
}

export function remove(fake: FakeEnv, id: string, token: string | null, now = START) {
  const headers: Record<string, string> =
    token === null ? {} : { authorization: `Bearer ${token}` };
  return call(fake, `/v1/shares/${id}`, { method: 'DELETE', headers }, now);
}

export interface Created {
  id: string;
  url: string;
  deleteToken: string;
  expiresAt: string;
}

export async function freshIds() {
  const deleteToken = randomToken(32);
  return { id: await shareIdFor(deleteToken), deleteToken };
}

export async function create(fake: FakeEnv, body: CreateBody = VALID_CREATE): Promise<Created> {
  const ids = await freshIds();
  const response = await postJson(fake, { ...body, ...ids });
  if (response.status !== 201) throw new Error(`create failed with ${response.status}`);
  const answer = (await response.json()) as Omit<Created, 'deleteToken'>;
  return { ...answer, deleteToken: ids.deleteToken };
}

export function postForm(fake: FakeEnv, path: string, fields: Record<string, string>, now = START) {
  return call(
    fake,
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    },
    now,
  );
}

export function frameSrc(html: string): string {
  const match = /<iframe[^>]* src="([^"]+)"/.exec(html);
  if (!match) throw new Error('no iframe');
  return match[1]!.replace(/&amp;/g, '&');
}

export function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0]!;
}
