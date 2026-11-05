import type { AgreedPlans } from '@spark-outpost/contracts';
import { conversationRoots } from '../persistence/conversation-projects.ts';
import type { Queryable } from '../persistence/db.ts';
import { planDocuments } from '../persistence/plan-documents.ts';
import { staleFiles } from './plan-staleness.ts';

export async function agreedPlans(db: Queryable, conversationId: string): Promise<AgreedPlans> {
  const documents = await planDocuments(db, conversationId);
  const approved = documents.findLast((document) => document.status === 'approved');
  if (!approved) return { documents, staleFiles: [] };
  const [root] = await conversationRoots(db, conversationId);
  return { documents, staleFiles: await staleFiles(root ?? null, approved) };
}
