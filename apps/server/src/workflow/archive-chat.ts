import type { ConversationSummary } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { updateConversation } from '../persistence/conversation-actions.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
} from '../persistence/provider-sessions.ts';
import { releaseConversation } from '../projects/chat-worktree-cleanup.ts';

export interface ArchiveTerminals {
  stop(conversationId: string): Promise<unknown>;
}

export async function finishArchive(
  db: Db,
  workspaceId: string,
  conversationId: string,
  terminals?: ArchiveTerminals,
  reason: string = SESSION_CLOSE_REASONS.archived,
): Promise<void> {
  await terminals?.stop(conversationId);
  await closeConversationSessions(db, workspaceId, conversationId, reason);
  await releaseConversation(db, conversationId, 'archived');
}

export async function archiveChat(
  db: Db,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const summary = await updateConversation(db, workspaceId, conversationId, { archived: true });
  await finishArchive(db, workspaceId, conversationId);
  return summary;
}
