import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  BROWSER_DOWNLOADS_KEPT,
  browserOrigin,
  type BrowserDownload,
} from '@spark-outpost/contracts';
import { userGestureCurrent, type InputMarks } from './clipboard-permission.ts';

export type DownloadStarter = BrowserDownload['by'];
export type DownloadPlace = BrowserDownload['where'];

export interface DownloadTab {
  chatId: string;
  downloadRefused?: boolean;
  inputMarks(): InputMarks;
}

export interface DownloadFile {
  getFilename(): string;
  getURL(): string;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  getSavePath(): string;
  setSaveDialogOptions(options: { title: string; defaultPath: string }): void;
  cancel(): void;
  on(event: 'updated', listener: () => void): unknown;
  once(event: 'done', listener: (event: unknown, state: string) => void): unknown;
}

export interface DownloadsOptions {
  downloadsDir: string;
  changed(list: BrowserDownload[]): void;
  reveal(filePath: string): void;
  quarantine(filePath: string): Promise<boolean>;
  log(line: string): void;
  now?: () => Date;
}

export function downloadStarter(marks: InputMarks | null, now: number): DownloadStarter {
  if (marks && userGestureCurrent(marks, now)) return 'you';
  if (!marks) return 'page';
  const agentLast =
    marks.agentDoneAt !== null &&
    (marks.userInputAt === null || marks.agentDoneAt >= marks.userInputAt);
  return marks.agentBusy > 0 || agentLast ? 'agent' : 'page';
}

function placeOf(tab: DownloadTab | null): DownloadPlace {
  if (tab?.chatId === 'personal' || tab?.chatId === 'work') return tab.chatId;
  return 'chat';
}

function hostOf(url: string): string {
  const origin = browserOrigin(url);
  return origin ? origin.replace(/^https?:\/\//, '') : '';
}

function doneState(state: string): BrowserDownload['state'] {
  if (state === 'completed') return 'saved';
  if (state === 'cancelled') return 'cancelled';
  return 'failed';
}

export class DownloadsList {
  private entries: BrowserDownload[] = [];
  private readonly files = new Map<string, DownloadFile>();
  private readonly saved = new Map<string, string>();

  constructor(private readonly options: DownloadsOptions) {}

  list(): BrowserDownload[] {
    return this.entries;
  }

  decide(file: DownloadFile, tab: DownloadTab | null): boolean {
    const now = this.options.now?.() ?? new Date();
    const by = downloadStarter(tab?.inputMarks() ?? null, now.getTime());
    const entry: BrowserDownload = {
      id: randomUUID(),
      filename: file.getFilename().slice(0, 255),
      host: hostOf(file.getURL()).slice(0, 255),
      where: placeOf(tab),
      by,
      state: by === 'you' ? 'saving' : 'blocked',
      receivedBytes: 0,
      totalBytes: Math.max(0, file.getTotalBytes()),
      at: now.toISOString(),
    };
    this.add(entry);
    if (by !== 'you') {
      if (tab) tab.downloadRefused = true;
      this.options.log(
        `Cancelled a download that ${by === 'agent' ? 'an agent' : 'a page'} started.`,
      );
      return false;
    }
    this.files.set(entry.id, file);
    file.setSaveDialogOptions({
      title: 'Save download',
      defaultPath: path.join(
        this.options.downloadsDir,
        path.basename(entry.filename) || 'download',
      ),
    });
    file.on('updated', () =>
      this.update(entry.id, {
        receivedBytes: Math.max(0, file.getReceivedBytes()),
        totalBytes: Math.max(0, file.getTotalBytes()),
      }),
    );
    file.once('done', (_event, state) => void this.finish(entry, file, state));
    return true;
  }

  private async finish(entry: BrowserDownload, file: DownloadFile, state: string): Promise<void> {
    this.files.delete(entry.id);
    const savedTo = file.getSavePath();
    if (state === 'completed' && savedTo) {
      if (!(await this.options.quarantine(savedTo))) {
        this.options.log('Could not mark a download as coming from the internet.');
      }
      this.saved.set(entry.id, savedTo);
    }
    this.update(entry.id, {
      state: doneState(state),
      filename: (path.basename(savedTo) || entry.filename).slice(0, 255),
      receivedBytes: Math.max(0, file.getReceivedBytes()),
    });
  }

  act(id: string, action: 'show' | 'cancel'): boolean {
    if (action === 'cancel') {
      const file = this.files.get(id);
      file?.cancel();
      return file !== undefined;
    }
    const savedTo = this.saved.get(id);
    if (savedTo) this.options.reveal(savedTo);
    return savedTo !== undefined;
  }

  private add(entry: BrowserDownload): void {
    const kept = [entry, ...this.entries].slice(0, BROWSER_DOWNLOADS_KEPT);
    const ids = new Set(kept.map((item) => item.id));
    for (const id of this.saved.keys()) if (!ids.has(id)) this.saved.delete(id);
    this.entries = kept;
    this.options.changed(this.entries);
  }

  private update(id: string, change: Partial<BrowserDownload>): void {
    this.entries = this.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry));
    this.options.changed(this.entries);
  }
}
