import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  memberMessageRequestSchema,
  queueAddRequestSchema,
  queueEditRequestSchema,
  queueOrderRequestSchema,
  type QueueResponse,
  type SendNowOutcome,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  addToQueue,
  editQueued,
  listQueue,
  QueueError,
  reorderQueue,
  takeQueued,
} from '../persistence/chat-queue.ts';
import { MemberMessageError, messageMember } from '../workflow/member-message.ts';
import { drainQueue, sendNow, type ResolveTarget } from '../workflow/queue-drain.ts';
import { resolveRunTarget } from './run-target.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface QueueRouteDeps {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
}

const itemParam = z.uuid();

function itemId(req: Request): string {
  const parsed = itemParam.safeParse(req.params.itemId);
  if (!parsed.success) throw new BadRequestError('The id must be a UUID.');
  return parsed.data;
}

export function queueErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof QueueError || error instanceof MemberMessageError) {
    return { status: error.status, message: error.message };
  }
  return null;
}

export function queueRoutes({ db, workspaceId, fixedRunProvider }: QueueRouteDeps): Router {
  const router = Router();
  const resolveTarget: ResolveTarget = (conversationId) =>
    resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId);

  const known = async (conversationId: string) => {
    const { rowCount } = await db.query('SELECT 1 FROM conversations WHERE id = $1', [
      conversationId,
    ]);
    if (rowCount !== 1) throw new QueueError(404, 'Conversation not found.');
  };

  const reply = async (conversationId: string, outcome?: SendNowOutcome) => {
    const body: QueueResponse = {
      queue: await listQueue(db, conversationId),
      ...(outcome ? { outcome } : {}),
    };
    return body;
  };

  router.get('/conversations/:id/queue', async (req, res) => {
    const conversationId = paramId(req);
    await known(conversationId);
    res.json(await reply(conversationId));
  });

  router.post('/conversations/:id/queue', async (req, res) => {
    const conversationId = paramId(req);
    const request = parseBody(queueAddRequestSchema, req);
    await known(conversationId);
    await addToQueue(db, conversationId, request);
    await drainQueue(db, conversationId, resolveTarget);
    res.status(201).json(await reply(conversationId));
  });

  router.patch('/conversations/:id/queue/:itemId', async (req, res) => {
    const conversationId = paramId(req);
    const { content } = parseBody(queueEditRequestSchema, req);
    await editQueued(db, conversationId, itemId(req), content);
    res.json(await reply(conversationId));
  });

  router.put('/conversations/:id/queue/order', async (req, res) => {
    const conversationId = paramId(req);
    const { ids } = parseBody(queueOrderRequestSchema, req);
    await reorderQueue(db, conversationId, ids);
    res.json(await reply(conversationId));
  });

  router.delete('/conversations/:id/queue/:itemId', async (req, res) => {
    const conversationId = paramId(req);
    await takeQueued(db, conversationId, itemId(req));
    res.json(await reply(conversationId));
  });

  router.post('/conversations/:id/queue/send-now', async (req, res) => {
    const conversationId = paramId(req);
    const request = parseBody(queueAddRequestSchema, req);
    await known(conversationId);
    const outcome = await sendNow(db, conversationId, request, resolveTarget);
    if (!outcome) throw new QueueError(404, 'Conversation not found.');
    res.status(202).json(await reply(conversationId, outcome));
  });

  router.post('/conversations/:id/queue/:itemId/send-now', async (req, res) => {
    const conversationId = paramId(req);
    const outcome = await sendNow(db, conversationId, { id: itemId(req) }, resolveTarget);
    if (!outcome) throw new QueueError(404, 'That message has already been sent.');
    res.status(202).json(await reply(conversationId, outcome));
  });

  router.post('/runs/:id/messages', async (req, res) => {
    const request = parseBody(memberMessageRequestSchema, req);
    res.status(202).json(await messageMember(db, paramId(req), request, resolveTarget));
  });

  return router;
}
