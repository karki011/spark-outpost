import type { PlanDocument, PlanDocumentSource } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  approvePlanDocument,
  insertPlanDocument,
  planForMessage,
  proposedPlanFromRun,
  type AssistantMessage,
} from '../persistence/plan-documents.ts';
import { headCommit } from '../projects/snapshot.ts';

export interface AgreementSource {
  by: 'user' | 'jev';
  source: Extract<PlanDocumentSource, 'chat' | 'user'>;
  root: string | null;
  approvedRunId: string | null;
}

export async function saveAgreedMessage(
  db: Db,
  message: AssistantMessage,
  agreement: AgreementSource,
): Promise<PlanDocument> {
  const saved = await planForMessage(db, message.id);
  if (saved?.status === 'approved') return saved;
  const commit = agreement.root ? await headCommit(agreement.root) : null;
  const approval = {
    by: agreement.by,
    option: null,
    runId: agreement.approvedRunId,
    commit,
  };
  const proposed = message.runId ? await proposedPlanFromRun(db, message.runId) : null;
  if (proposed) return approvePlanDocument(db, proposed.id, approval);
  return insertPlanDocument(db, {
    conversationId: message.conversationId,
    taskId: message.taskId,
    source: agreement.source,
    body: message.content,
    sourceRunId: message.runId,
    sourceMessageId: message.id,
    approval,
  });
}
