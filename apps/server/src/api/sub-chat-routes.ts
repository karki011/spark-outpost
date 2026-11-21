import { Router } from 'express';
import type { SubChatsResponse } from '@spark-outpost/contracts';
import { ConversationNotFoundError } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { subChatRows } from '../persistence/sub-chats.ts';
import { paramId } from './validation.ts';

export interface SubChatRouteDeps {
  db: Db;
  workspaceId: string;
}

export function subChatRoutes({ db, workspaceId }: SubChatRouteDeps): Router {
  const router = Router();

  router.get('/conversations/:id/sub-chats', async (req, res) => {
    const id = paramId(req);
    const found = await db.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    if (!found.rowCount) throw new ConversationNotFoundError(id);
    const body: SubChatsResponse = { subChats: await subChatRows(db, id) };
    res.json(body);
  });

  return router;
}
