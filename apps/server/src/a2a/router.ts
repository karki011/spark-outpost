import { AgentCard, AGENT_CARD_PATH } from '@a2a-js/sdk';
import { jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { resolveRunTarget } from '../api/run-target.ts';
import type { Db } from '../persistence/db.ts';
import { getPost, requestAnswer } from '../persistence/outpost-posts.ts';
import { chatFacts } from '../persistence/outpost-tasks.ts';
import { drainQueue } from '../workflow/queue-drain.ts';
import { stopRun } from '../workflow/stop-run.ts';
import { a2aBaseUrl, agentCard } from './agent-card.ts';
import { outpostRequestHandler, type HandlerDeps } from './request-handler.ts';
import type { TaskWakes } from './task-wakes.ts';

export interface A2aRouteOptions {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
  port: number;
  wakes: TaskWakes;
}

const chatParam = z.uuid();

function chatIdOf(req: Request): string | null {
  const parsed = chatParam.safeParse(req.params.chatId);
  return parsed.success ? parsed.data : null;
}

function noSuchAgent(res: Response): void {
  res.status(404).json({ error: 'No chat takes requests at this address.' });
}

function untilClosed(res: Response): AbortSignal {
  const closed = new AbortController();
  res.once('close', () => closed.abort());
  return closed.signal;
}

export function a2aRoutes(options: A2aRouteOptions): Router {
  const { db, workspaceId, fixedRunProvider } = options;
  const router = Router();
  const deps: HandlerDeps = {
    db,
    baseUrl: a2aBaseUrl(options.port),
    getPost,
    readAnswer: (queryable, request) => requestAnswer(queryable, workspaceId, request),
    wakes: options.wakes,
    drain: (conversationId) =>
      drainQueue(db, conversationId, (id) =>
        resolveRunTarget({ db, workspaceId, fixedRunProvider }, id),
      ),
    stopRun: (runId) => stopRun(db, runId),
  };

  router.get(`/chats/:chatId/${AGENT_CARD_PATH}`, async (req, res) => {
    const chatId = chatIdOf(req);
    const chat = chatId === null ? null : await chatFacts(db, chatId);
    if (chat === null) {
      noSuchAgent(res);
      return;
    }
    res.json(AgentCard.toJSON(agentCard(chat, deps.baseUrl)));
  });

  router.post('/chats/:chatId', async (req, res, next) => {
    const chatId = chatIdOf(req);
    if (chatId === null || (await chatFacts(db, chatId)) === null) {
      noSuchAgent(res);
      return;
    }
    const serve = jsonRpcHandler({
      requestHandler: outpostRequestHandler(deps, chatId, untilClosed(res)),
      userBuilder: UserBuilder.noAuthentication,
    });
    req.url = '/';
    serve(req, res, next);
  });

  return router;
}
