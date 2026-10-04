import { Router } from 'express';
import {
  chatContextRequestSchema,
  parseChatReference,
  sparkChatLink,
  type ChatLinkResponse,
} from '@spark-outpost/contracts';
import { chatContextFromReference } from '../chat-share/context.ts';
import { ChatNotFoundError } from '../chat-share/digest.ts';
import type { Db } from '../persistence/db.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface ChatShareRouteDeps {
  db: Db;
  workspaceId: string;
  linkScheme?: string | undefined;
  now?: () => Date;
}

export function chatShareRoutes({ db, workspaceId, linkScheme, now }: ChatShareRouteDeps): Router {
  const router = Router();

  router.get('/conversations/:id/share', async (req, res) => {
    const id = paramId(req);
    const { rowCount } = await db.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId],
    );
    if (rowCount !== 1) throw new ChatNotFoundError();
    const response: ChatLinkResponse = { id, link: sparkChatLink(id, linkScheme) };
    res.json(response);
  });

  router.post('/chat-context', async (req, res) => {
    const { reference } = parseBody(chatContextRequestSchema, req);
    const chatId = parseChatReference(reference);
    if (!chatId) {
      throw new BadRequestError('That is not a chat link. Use Copy chat link in the chat menu.');
    }
    const context = await chatContextFromReference(db, workspaceId, chatId, {
      now: now?.() ?? new Date(),
      linkScheme,
    });
    res.status(201).json(context);
  });

  return router;
}
