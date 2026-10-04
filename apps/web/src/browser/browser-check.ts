import {
  touchesUi,
  type BrowserShot,
  type ChangeSummary,
  type ConversationDetail,
  type Run,
} from '@spark-outpost/contracts';

export type BrowserCheck = { state: 'checked'; shot: BrowserShot } | { state: 'not_checked' };

export interface BrowserCheckFacts {
  shots: readonly BrowserShot[];
  request: string;
  changed: KeptChanges;
  paneAvailable: boolean;
}

export interface KeptChanges {
  any: boolean;
  files: readonly string[];
}

export function browserCheckOf(facts: BrowserCheckFacts): BrowserCheck | null {
  const latest = facts.shots.at(-1);
  if (latest) return { state: 'checked', shot: latest };
  if (!facts.paneAvailable || !facts.changed.any) return null;
  return touchesUi(facts.request, facts.changed.files) ? { state: 'not_checked' } : null;
}

export function turnShots(detail: ConversationDetail, runId: string): BrowserShot[] {
  return (detail.browserShots ?? []).filter((shot) => shot.turnRunId === runId);
}

export function turnRequest(detail: ConversationDetail, run: Run): string {
  return detail.messages.find((message) => message.id === run.userMessageId)?.content ?? '';
}

export function keptChanges(
  summary: ChangeSummary | undefined,
  runIds: readonly string[],
): KeptChanges {
  const live = new Set(
    (summary?.runs ?? [])
      .filter((run) => runIds.includes(run.runId) && !run.revertedAt && run.files > 0)
      .map((run) => run.runId),
  );
  const files = (summary?.top ?? []).filter((file) => live.has(file.runId));
  return { any: live.size > 0, files: files.map((file) => file.path) };
}
