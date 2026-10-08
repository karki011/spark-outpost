import type { AgreedPlans, PlanDocument } from '@spark-outpost/contracts';
import { conversationRoots } from '../persistence/conversation-projects.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import {
  approvePlanDocument,
  insertPlanDocument,
  planDocuments,
  planForMessage,
  proposedPlanFromRun,
  type AssistantMessage,
} from '../persistence/plan-documents.ts';
import { headCommit } from '../projects/snapshot.ts';
import { staleFiles } from './plan-staleness.ts';

export interface AgreementSource {
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
    by: 'jev' as const,
    option: null,
    runId: agreement.approvedRunId,
    commit,
  };
  const proposed = message.runId ? await proposedPlanFromRun(db, message.runId) : null;
  if (proposed) return approvePlanDocument(db, proposed.id, approval);
  return insertPlanDocument(db, {
    conversationId: message.conversationId,
    taskId: message.taskId,
    source: 'chat',
    body: message.content,
    sourceRunId: message.runId,
    sourceMessageId: message.id,
    approval,
  });
}

export async function agreedPlans(db: Queryable, conversationId: string): Promise<AgreedPlans> {
  const documents = await planDocuments(db, conversationId);
  const approved = documents.findLast((document) => document.status === 'approved');
  if (!approved) return { documents, staleFiles: [] };
  const [root] = await conversationRoots(db, conversationId);
  return { documents, staleFiles: await staleFiles(root ?? null, approved) };
}
