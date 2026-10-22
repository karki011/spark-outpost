import type { DownloadItem, Session } from 'electron';
import { fromArtifactPage } from './artifact-frames.ts';

export interface DownloadGuardOptions {
  focus: () => void;
  log: (line: string) => void;
}

type DownloadSession = Pick<Session, 'on'>;

export function guardDownloads(target: DownloadSession, options: DownloadGuardOptions): void {
  let saving: DownloadItem | null = null;
  target.on('will-download', (event, item) => {
    if (fromArtifactPage(item.getURL())) {
      event.preventDefault();
      options.log('Refused a download from an artifact.');
      return;
    }
    if (saving) {
      event.preventDefault();
      options.focus();
      options.log(`Skipped ${item.getFilename()} while ${saving.getFilename()} is still saving.`);
      return;
    }
    saving = item;
    item.once('done', (_done, state) => {
      saving = null;
      options.log(`Download ${state}: ${item.getFilename()}.`);
    });
  });
}
