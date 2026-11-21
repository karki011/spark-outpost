import { Router } from 'express';
import type { SubChatsResponse } from '@spark-outpost/contracts';
import { ConversationNotFoundError } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { getSubChat, SubChatError, subChatRows } from '../persistence/sub-chats.ts';
import { NOT_THIS_CHATS_SUB_CHAT, startHeldSubChat } from '../sub-chats/start.ts';
import { resolveRunTarget } from './run-target.ts';
import { paramId } from './validation.ts';

export interface SubChatRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

export const STARTED_BY_USER = 'the user chose Start anyway';

export function subChatErrorStatus(error: unknown): { status: number; message: string } | null {
  return error instanceof SubChatError ? { status: 409, message: error.message } : null;
}

export function subChatRoutes({ db, workspaceId, fixedRunProvider }: SubChatRouteDeps): Router {
  const router = Router();

  const known = async (id: string) => {
    const found = await db.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    if (!found.rowCount) throw new ConversationNotFoundError(id);
  };

  router.get('/conversations/:id/sub-chats', async (req, res) => {
    const id = paramId(req);
    await known(id);
    const body: SubChatsResponse = { subChats: await subChatRows(db, id) };
    res.json(body);
  });

  router.post('/conversations/:id/sub-chats/:subChatId/start', async (req, res) => {
    const id = paramId(req);
    const subChatId = paramId(req, 'subChatId');
    await known(id);
    const subChat = await getSubChat(db, subChatId);
    if (subChat?.parentConversationId !== id) throw new SubChatError(NOT_THIS_CHATS_SUB_CHAT);
    await startHeldSubChat(
      {
        db,
        workspaceId,
        resolveTarget: (conversationId) =>
          resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId),
      },
      subChatId,
      STARTED_BY_USER,
    );
    const body: SubChatsResponse = { subChats: await subChatRows(db, id) };
    res.json(body);
  });

  return router;
}
