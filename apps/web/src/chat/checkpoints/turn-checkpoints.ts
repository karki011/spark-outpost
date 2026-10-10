import type { ConversationDetail } from '@spark-outpost/contracts';
import { mergeCheckpoints } from '../crew/crew-items.ts';
import type { CheckpointApproval } from './checkpoint-model.ts';

export function turnCheckpoints(runId: string, detail: ConversationDetail): CheckpointApproval[] {
  return mergeCheckpoints(
    detail.orchestrations?.[runId]?.checkpoints ?? [],
    detail.approvals.filter((approval) => approval.runId === runId),
  );
}
