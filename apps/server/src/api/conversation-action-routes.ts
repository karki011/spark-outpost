import { Router } from 'express';
import {
  pinnedOrderRequestSchema,
  updateConversationRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  deleteConversation,
  markConversationRead,
  orderPinned,
  updateConversation,
} from '../persistence/conversation-actions.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
  conversationWorkdirs,
} from '../persistence/provider-sessions.ts';
import { removeWorkdirs } from '../workflow/turn-session.ts';
import { paramId, parseBody } from './validation.ts';

export interface ConversationActionDeps {
  db: Db;
  workspaceId: string;
}

export function conversationActionRoutes({ db, workspaceId }: ConversationActionDeps): Router {
  const router = Router();

  router.put('/conversations/pinned-order', async (req, res) => {
    const { conversationIds } = parseBody(pinnedOrderRequestSchema, req);
    await orderPinned(db, workspaceId, conversationIds);
    res.status(204).end();
  });

  router.patch('/conversations/:id', async (req, res) => {
    const update = parseBody(updateConversationRequestSchema, req);
    const id = paramId(req);
    const summary = await updateConversation(db, workspaceId, id, update);
    if (update.archived === true) {
      await closeConversationSessions(db, workspaceId, id, SESSION_CLOSE_REASONS.archived);
    }
    res.json(summary);
  });

  router.post('/conversations/:id/fresh-session', async (req, res) => {
    const id = paramId(req);
    const closed = await closeConversationSessions(
      db,
      workspaceId,
      id,
      SESSION_CLOSE_REASONS.fresh,
    );
    res.json({ closed });
  });

  router.post('/conversations/:id/read', async (req, res) => {
    await markConversationRead(db, workspaceId, paramId(req));
    res.status(204).end();
  });

  router.delete('/conversations/:id', async (req, res) => {
    const id = paramId(req);
    const workdirs = await conversationWorkdirs(db, id);
    await deleteConversation(db, workspaceId, id);
    await removeWorkdirs(workdirs);
    res.status(204).end();
  });

  return router;
}
