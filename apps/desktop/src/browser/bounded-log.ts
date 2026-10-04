import { BROWSER_LOG_TEXT_MAX, type BrowserLogEntry } from '@spark-outpost/contracts';

export const LOG_CAPACITY = 300;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function withoutQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : `${value.slice(0, cut)}?…`;
}

export class BoundedLog {
  private entries: BrowserLogEntry[] = [];
  private lost = 0;
  private readonly capacity: number;

  constructor(capacity = LOG_CAPACITY) {
    this.capacity = capacity;
  }

  push(entry: Omit<BrowserLogEntry, 'at'> & { at?: string }): void {
    this.entries.push({
      ...entry,
      at: entry.at ?? new Date().toISOString(),
      text: clip(entry.text, BROWSER_LOG_TEXT_MAX),
      source: entry.source === null ? null : clip(entry.source, 300),
    });
    const extra = this.entries.length - this.capacity;
    if (extra <= 0) return;
    this.entries.splice(0, extra);
    this.lost += extra;
  }

  clear(): void {
    this.entries = [];
    this.lost = 0;
  }

  recent(filter: string | undefined, limit: number): BrowserLogEntry[] {
    const needle = filter?.toLowerCase();
    const matching = needle
      ? this.entries.filter((entry) =>
          `${entry.level} ${entry.text} ${entry.source ?? ''} ${entry.status ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
      : this.entries;
    return matching.slice(-limit);
  }

  dropped(): number {
    return this.lost;
  }
}
