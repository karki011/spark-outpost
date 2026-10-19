import {
  BROWSER_INITIATOR_MAX,
  BROWSER_NETWORK_CAPACITY,
  BROWSER_URL_MAX,
  redactQuery,
  type BrowserNetworkEntry,
} from '@spark-outpost/contracts';

type Params = Record<string, unknown>;

interface CallFrame {
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface Initiator {
  type?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: { callFrames?: CallFrame[]; parent?: { callFrames?: CallFrame[] } };
}

interface ResponseFacts {
  status?: number;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  fromPrefetchCache?: boolean;
  encodedDataLength?: number;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shownUrl(url: string): string {
  return clip(redactQuery(url), BROWSER_URL_MAX);
}

function place(url: string, line?: number, column?: number): string {
  const where =
    line === undefined ? '' : `:${line + 1}${column === undefined ? '' : `:${column + 1}`}`;
  return `${redactQuery(url)}${where}`;
}

export function initiatorText(initiator: Initiator | undefined): string | null {
  if (!initiator?.type) return null;
  const frames = [
    ...(initiator.stack?.callFrames ?? []),
    ...(initiator.stack?.parent?.callFrames ?? []),
  ];
  const frame = frames.find((candidate) => candidate.url);
  if (frame?.url) {
    return clip(
      `script ${place(frame.url, frame.lineNumber, frame.columnNumber)}`,
      BROWSER_INITIATOR_MAX,
    );
  }
  if (initiator.url) {
    return clip(
      `${initiator.type} ${place(initiator.url, initiator.lineNumber, initiator.columnNumber)}`,
      BROWSER_INITIATOR_MAX,
    );
  }
  return initiator.type;
}

function fromCache(response: ResponseFacts): boolean {
  return (
    response.fromDiskCache === true ||
    response.fromServiceWorker === true ||
    response.fromPrefetchCache === true
  );
}

export class NetworkLog {
  private entries: BrowserNetworkEntry[] = [];
  private readonly open = new Map<string, BrowserNetworkEntry>();
  private zero: number | null = null;
  private lost = 0;
  private readonly capacity: number;

  constructor(capacity = BROWSER_NETWORK_CAPACITY) {
    this.capacity = capacity;
  }

  private ms(timestamp: unknown): number {
    const seconds = typeof timestamp === 'number' ? timestamp : null;
    if (seconds === null) return 0;
    this.zero ??= seconds;
    return Math.max(0, Math.round((seconds - this.zero) * 1000 * 10) / 10);
  }

  private add(entry: BrowserNetworkEntry): void {
    this.entries.push(entry);
    const extra = this.entries.length - this.capacity;
    if (extra <= 0) return;
    for (const dropped of this.entries.splice(0, extra)) {
      for (const [id, live] of this.open) if (live === dropped) this.open.delete(id);
    }
    this.lost += extra;
  }

  private finish(id: string, change: () => Partial<BrowserNetworkEntry>): void {
    const entry = this.open.get(id);
    if (!entry) return;
    Object.assign(entry, change());
    this.open.delete(id);
  }

  requestWillBeSent(params: Params): void {
    const id = String(params.requestId);
    const redirect = params.redirectResponse as ResponseFacts | undefined;
    if (redirect && this.open.has(id)) {
      this.finish(id, () => ({
        status: redirect.status ?? null,
        endMs: this.ms(params.timestamp),
        encodedBytes: redirect.encodedDataLength ?? null,
        fromCache: fromCache(redirect),
      }));
    }
    const request = (params.request ?? {}) as { url?: string; method?: string };
    const wall = typeof params.wallTime === 'number' ? params.wallTime * 1000 : Date.now();
    const entry: BrowserNetworkEntry = {
      at: new Date(wall).toISOString(),
      method: clip(request.method ?? 'GET', 12),
      url: shownUrl(request.url ?? ''),
      status: null,
      type: typeof params.type === 'string' ? clip(params.type, 40) : null,
      initiator: initiatorText(params.initiator as Initiator | undefined),
      startMs: this.ms(params.timestamp),
      endMs: null,
      encodedBytes: null,
      decodedBytes: null,
      fromCache: false,
      failed: null,
    };
    this.open.set(id, entry);
    this.add(entry);
  }

  responseReceived(params: Params): void {
    const entry = this.open.get(String(params.requestId));
    if (!entry) return;
    const response = (params.response ?? {}) as ResponseFacts;
    entry.status = response.status ?? null;
    entry.fromCache ||= fromCache(response);
    if (typeof params.type === 'string') entry.type = clip(params.type, 40);
  }

  servedFromCache(params: Params): void {
    const entry = this.open.get(String(params.requestId));
    if (entry) entry.fromCache = true;
  }

  dataReceived(params: Params): void {
    const entry = this.open.get(String(params.requestId));
    if (!entry || typeof params.dataLength !== 'number') return;
    entry.decodedBytes = (entry.decodedBytes ?? 0) + params.dataLength;
  }

  loadingFinished(params: Params): void {
    const encoded = typeof params.encodedDataLength === 'number' ? params.encodedDataLength : null;
    this.finish(String(params.requestId), () => ({
      endMs: this.ms(params.timestamp),
      encodedBytes: encoded === null ? null : Math.round(encoded),
    }));
  }

  loadingFailed(params: Params): void {
    const why =
      params.canceled === true
        ? 'canceled'
        : String(params.blockedReason ?? params.errorText ?? 'failed');
    this.finish(String(params.requestId), () => ({
      endMs: this.ms(params.timestamp),
      failed: clip(why, 200),
    }));
  }

  all(): BrowserNetworkEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  dropped(): number {
    return this.lost;
  }

  clear(): void {
    this.entries = [];
    this.open.clear();
    this.zero = null;
    this.lost = 0;
  }
}
