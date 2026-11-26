import type { EventDataset } from './events.ts';

export interface StoredObject {
  key: string;
  customMetadata?: Record<string, string>;
}

export interface StoredObjectBody extends StoredObject {
  text(): Promise<string>;
}

export interface ListResult {
  objects: StoredObject[];
  truncated: boolean;
  cursor?: string;
}

export interface ListOptions {
  prefix: string;
  cursor?: string;
  include?: 'customMetadata'[];
}

export interface PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  onlyIf?: { etagDoesNotMatch: string };
}

export interface ShareBucket {
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<StoredObjectBody | null>;
  put(key: string, value: string | Uint8Array, options?: PutOptions): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: ListOptions): Promise<ListResult>;
}

export interface CounterStub {
  fetch(request: Request): Promise<Response>;
}

export interface CounterNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): CounterStub;
}

export interface ShareEnv {
  SHARES: ShareBucket;
  COUNTERS: CounterNamespace;
  EVENTS?: EventDataset;
  SIGNING_KEY?: string;
  UPLOAD_KEY?: string;
  MAX_EXPIRY_DAYS?: string;
}
