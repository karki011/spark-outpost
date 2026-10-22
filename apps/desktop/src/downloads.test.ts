import { EventEmitter } from 'node:events';
import type { DownloadItem, Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { allowArtifactFrames } from './artifact-frames.ts';
import { guardDownloads } from './downloads.ts';

class FakeItem extends EventEmitter {
  constructor(
    private readonly name: string,
    private readonly url: string,
  ) {
    super();
  }

  getFilename(): string {
    return this.name;
  }

  getURL(): string {
    return this.url;
  }
}

function download(session: EventEmitter, name: string, url = `http://127.0.0.1:4318/${name}`) {
  const item = new FakeItem(name, url);
  const event = { preventDefault: vi.fn() };
  session.emit('will-download', event, item as unknown as DownloadItem);
  return { item, event };
}

function setup() {
  const session = new EventEmitter();
  const focus = vi.fn();
  const lines: string[] = [];
  guardDownloads(session as unknown as Session, { focus, log: (line) => lines.push(line) });
  return { session, focus, lines };
}

describe('guardDownloads', () => {
  it('refuses a download that comes from an artifact page', () => {
    allowArtifactFrames(4318);
    const { session, lines } = setup();
    const refused = download(session, 'x.html', 'http://127.0.0.1:14318/v/abc');
    expect(refused.event.preventDefault).toHaveBeenCalledOnce();
    expect(lines).toEqual(['Refused a download from an artifact.']);
    expect(download(session, 'audit.jsonl').event.preventDefault).not.toHaveBeenCalled();
  });

  it('lets one download open its save dialog and skips repeats until it finishes', () => {
    const { session, focus, lines } = setup();
    const first = download(session, 'audit.jsonl');
    expect(first.event.preventDefault).not.toHaveBeenCalled();

    const second = download(session, 'audit.jsonl');
    expect(second.event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(lines).toEqual(['Skipped audit.jsonl while audit.jsonl is still saving.']);

    first.item.emit('done', {}, 'completed');
    const third = download(session, 'cost.csv');
    expect(third.event.preventDefault).not.toHaveBeenCalled();
    expect(lines.at(-1)).toBe('Download completed: audit.jsonl.');
  });

  it('frees the slot when the user cancels the save dialog', () => {
    const { session } = setup();
    const first = download(session, 'audit.jsonl');
    first.item.emit('done', {}, 'cancelled');
    expect(download(session, 'audit.jsonl').event.preventDefault).not.toHaveBeenCalled();
  });
});
