import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  queueAddRequestSchema,
  queueEditRequestSchema,
  queueOrderRequestSchema,
  type QueueAddRequest,
  type QueueResponse,
  type SendNowOutcome,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { missedMessage, removeMemberMessages } from '../persistence/member-messages.ts';
import {
  addToQueue,
  editQueued,
  listQueue,
  QueueError,
  queuedOutpostPost,
  reorderQueue,
  takeQueued,
} from '../persistence/chat-queue.ts';
import { cancelPost } from '../persistence/outpost-tasks.ts';
import { stopRun } from '../workflow/stop-run.ts';
import { drainQueue, resendMissed, sendNow, type ResolveTarget } from '../workflow/queue-drain.ts';
import { resolveRunTarget } from './run-target.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

async function sentOrSending(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query<{ taken: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM messages WHERE id = $1)
       OR EXISTS (SELECT 1 FROM member_messages WHERE id = $1) AS taken`,
    [id],
  );
  return rows[0]?.taken === true;
}

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
  if (error instanceof QueueError) {
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

  const queuedRequest = async (conversationId: string, request: QueueAddRequest) => {
    if (request.origin !== 'pages') return request;
    const { rowCount } = await db.query(
      'SELECT 1 FROM profiles WHERE workspace_id = $1 AND assistant_conversation_id = $2',
      [workspaceId, conversationId],
    );
    if (rowCount !== 1) throw new BadRequestError('Only Ask Spark takes questions about tabs.');
    return request;
  };

  const reply = async (conversationId: string, outcome?: SendNowOutcome) => {
    const body: QueueResponse = {
      queue: await listQueue(db, conversationId),
      ...(outcome ? { outcome } : {}),
    };
    return body;
  };

  const removeQueued = async (conversationId: string, id: string) => {
    const postId = await queuedOutpostPost(db, conversationId, id);
    if (postId === null) {
      if (await takeQueued(db, conversationId, id)) return;
      if (await sentOrSending(db, id)) {
        throw new QueueError(409, 'That message has already been sent.');
      }
      return;
    }
    const outcome = await cancelPost(db, postId);
    if (outcome.kind === 'stopping') await stopRun(db, outcome.runId);
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
    await addToQueue(db, conversationId, await queuedRequest(conversationId, request));
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
    await removeQueued(conversationId, itemId(req));
    res.json(await reply(conversationId));
  });

  router.post('/conversations/:id/queue/send-now', async (req, res) => {
    const conversationId = paramId(req);
    const request = parseBody(queueAddRequestSchema, req);
    await known(conversationId);
    const outcome = await sendNow(
      db,
      conversationId,
      await queuedRequest(conversationId, request),
      resolveTarget,
    );
    if (!outcome) throw new QueueError(404, 'Conversation not found.');
    res.status(202).json(await reply(conversationId, outcome));
  });

  router.post('/conversations/:id/queue/:itemId/send-now', async (req, res) => {
    const conversationId = paramId(req);
    const outcome = await sendNow(db, conversationId, { id: itemId(req) }, resolveTarget);
    if (!outcome) throw new QueueError(404, 'That message has already been sent.');
    res.status(202).json(await reply(conversationId, outcome));
  });

  const NOT_WAITING = 'That message is no longer waiting.';

  router.post('/conversations/:id/steers/:itemId/resend', async (req, res) => {
    const conversationId = paramId(req);
    const outcome = await resendMissed(db, conversationId, itemId(req), resolveTarget);
    if (!outcome) throw new QueueError(404, NOT_WAITING);
    res.status(202).json(await reply(conversationId));
  });

  router.delete('/conversations/:id/steers/:itemId', async (req, res) => {
    const conversationId = paramId(req);
    await withTransaction(db, async (client) => {
      if (!(await missedMessage(client, conversationId, itemId(req)))) {
        throw new QueueError(404, NOT_WAITING);
      }
      await removeMemberMessages(client, [itemId(req)]);
    });
    res.json(await reply(conversationId));
  });

  return router;
}
