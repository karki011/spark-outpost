import type { BackgroundWait, BusyEnterAction } from '@spark-outpost/contracts';
import { MAC } from '../../ui/shortcuts.ts';
import type { AttachmentsState } from '../attachments/use-attachments.ts';
import { busyHint } from '../queue/send-choice.ts';

export function composerHint(
  attachments: AttachmentsState,
  queueing: boolean,
  preferred: BusyEnterAction,
  waitingOn = 0,
  background: BackgroundWait | null = null,
): string {
  if (attachments.uploading) return 'Uploading your files…';
  if (attachments.failed) return 'Remove or retry the files that failed';
  if (queueing && waitingOn > 0) return busyHint(preferred, MAC, waitingOn, background);
  return '';
}

interface PlaceholderFacts {
  queueing: boolean;
  preferred: BusyEnterAction;
  hasRepos: boolean;
  hasSparks: boolean;
}

export function composerPlaceholder(facts: PlaceholderFacts): string {
  if (facts.queueing && facts.preferred === 'now') return 'Send a message to the running turn';
  if (facts.queueing) return 'Queue a message for when this turn ends';
  if (facts.hasRepos && facts.hasSparks)
    return 'Ask anything. @ for files or a Spark, / for commands';
  if (facts.hasRepos) return 'Ask anything. @ for files, / for commands';
  if (facts.hasSparks) return 'Ask anything. @ for a Spark, / for commands';
  return 'Ask anything. / for commands';
}

export function focusAtEnd(input: HTMLTextAreaElement): void {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

export function focusMovesToSlashMenu(next: EventTarget | null): boolean {
  return next instanceof Element && next.closest('.slashpop') !== null;
}
