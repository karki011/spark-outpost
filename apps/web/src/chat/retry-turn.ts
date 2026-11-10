import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { activeRuns, topLevelRuns } from './turns.ts';

function startedByUser(run: Run): boolean {
  return (
    run.typedByUser === true &&
    !(
      run.outpost ||
      run.prFollowUp ||
      run.agentCycle ||
      run.continuesRunId ||
      run.interruptionChoice
    )
  );
}

export function retryableMessage(detail: ConversationDetail, run: Run): string | null {
  if (run.status !== 'failed' || !run.userMessageId || !startedByUser(run)) return null;
  if (topLevelRuns(detail).at(-1)?.id !== run.id) return null;
  if (activeRuns(detail).length > 0 || (detail.queue?.length ?? 0) > 0) return null;
  const message = detail.messages.find((candidate) => candidate.id === run.userMessageId);
  if (message?.role !== 'user' || message.attachments.length > 0) return null;
  return message.content.trim() === '' ? null : message.content;
}
