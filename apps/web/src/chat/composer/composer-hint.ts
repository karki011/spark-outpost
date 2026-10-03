import type { AttachmentsState } from '../attachments/use-attachments.ts';

export function composerHint(attachments: AttachmentsState, queueing: boolean): string {
  if (attachments.uploading) return 'Uploading your files…';
  if (attachments.failed) return 'Remove or retry the files that failed';
  if (queueing && attachments.items.length > 0) return 'Files wait until this turn ends';
  if (queueing) return 'Enter to queue, it sends when this turn ends';
  return 'Enter to send, Shift + Enter for a new line';
}
