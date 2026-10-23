import type { BrowserDownload } from '@spark-outpost/contracts';
import { formatBytes } from '../api/attachments.ts';

export type DownloadTone = 'ok' | 'busy' | 'stopped' | 'refused';

const WHERE: Record<BrowserDownload['where'], string> = {
  personal: 'Personal',
  work: 'Work',
  chat: 'a chat',
};

function progress(entry: BrowserDownload): string {
  if (entry.totalBytes === 0) return formatBytes(entry.receivedBytes);
  return `${Math.floor((entry.receivedBytes / entry.totalBytes) * 100)}%`;
}

export function downloadStatus(entry: BrowserDownload): { tone: DownloadTone; text: string } {
  const from = [entry.host, WHERE[entry.where]].filter(Boolean).join(' · ');
  switch (entry.state) {
    case 'saving':
      return { tone: 'busy', text: `Saving · ${progress(entry)} · ${from}` };
    case 'saved':
      return { tone: 'ok', text: `Saved · ${formatBytes(entry.receivedBytes)} · ${from}` };
    case 'cancelled':
      return { tone: 'stopped', text: `Cancelled · ${from}` };
    case 'failed':
      return { tone: 'stopped', text: `Didn’t finish · ${from}` };
    case 'blocked':
      return {
        tone: 'refused',
        text:
          entry.by === 'agent'
            ? `Not saved: an agent’s action started it · ${from}`
            : `Not saved: you didn’t start it · ${from}`,
      };
  }
}
