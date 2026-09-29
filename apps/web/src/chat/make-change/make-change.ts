import { PERMISSION_DO, type ConversationDetail, type Run } from '@spark-outpost/contracts';

export function answeredInsteadOfChange(run: Run, detail: ConversationDetail): boolean {
  if (run.status !== 'succeeded' || run.pickedMode !== 'do' || run.mode !== 'ask') return false;
  if (detail.settings.permission !== PERMISSION_DO) return false;
  const latest = detail.runs.findLast((candidate) => !candidate.parentRunId);
  return latest?.id === run.id;
}
