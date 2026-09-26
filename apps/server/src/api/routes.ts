import { Router } from 'express';
import {
  CONVERSATION_SEARCH_MAX_LENGTH,
  createConversationRequestSchema,
  sendMessageRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  ConversationNotFoundError,
  MessageConflictError,
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
  type RunTarget,
} from '../persistence/conversations.ts';
import { ConversationBusyError } from '../persistence/conversation-actions.ts';
import { getRun, requestCancel } from '../persistence/runs.ts';
import { loadOrchestration } from '../persistence/orchestrations.ts';
import { advisorUsageSummary } from '../persistence/advice.ts';
import { usageSummary } from '../persistence/usage.ts';
import { categoryUsage } from '../persistence/category-usage.ts';
import {
  ConversationMissingError,
  draftChatSettings,
  getCapabilities,
  resolveChatSettings,
} from '../persistence/chat-settings.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import { TerminalLimitError } from '../terminal/sessions.ts';
import type { RunEventHub } from './run-event-hub.ts';
import { streamRunEvents } from './run-stream.ts';
import { AttachmentError } from '../persistence/attachment-content.ts';
import { FolderError } from '../projects/folders.ts';
import { ProjectNotFoundError } from '../projects/projects.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { BadRequestError, UploadTooLargeError, paramId, parseBody } from './validation.ts';
import { approvalErrorStatus } from './approval-routes.ts';

export interface RouteDeps {
  db: Db;
  hub: RunEventHub;
  workspaceId: string;
  fixedRunProvider?: string;
}

export function apiRoutes({ db, hub, workspaceId, fixedRunProvider }: RouteDeps): Router {
  const router = Router();

  const runTarget = async (conversationId: string): Promise<RunTarget> => {
    if (fixedRunProvider) return { provider: fixedRunProvider };
    const settings = await resolveChatSettings(db, conversationId).catch((error: unknown) => {
      if (error instanceof ConversationMissingError) return draftChatSettings(db, workspaceId);
      throw error;
    });
    if (!settings.provider) {
      throw new BadRequestError('Connect an AI provider before sending a message.');
    }
    const capabilities = await getCapabilities(db, workspaceId, settings.provider);
    const offered =
      settings.model !== null &&
      (!capabilities || capabilities.models.some((model) => model.id === settings.model));
    return {
      provider: settings.provider,
      model: offered ? settings.model : (capabilities?.defaultModel ?? null),
      effort: settings.effort,
      permission: settings.permission,
      level: settings.level,
    };
  };

  router.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  router.get('/conversations', async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q : '';
    if (search.length > CONVERSATION_SEARCH_MAX_LENGTH) {
      throw new BadRequestError('Search for a shorter phrase.');
    }
    res.json(await listConversations(db, workspaceId, search));
  });

  router.post('/conversations', async (req, res) => {
    const { id } = parseBody(createConversationRequestSchema, req);
    res.status(201).json(await createConversation(db, workspaceId, id));
  });

  router.get('/conversations/:id', async (req, res) => {
    const detail = await getConversationDetail(db, paramId(req));
    if (!detail) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(detail);
  });

  router.post('/conversations/:id/messages', async (req, res) => {
    const request = parseBody(sendMessageRequestSchema, req);
    const conversationId = paramId(req);
    const target = await runTarget(conversationId);
    res.status(201).json(await sendUserMessage(db, conversationId, request, target, workspaceId));
  });

  router.get('/usage/summary', async (_req, res) => {
    const [summary, advisors, byCategory] = await Promise.all([
      usageSummary(db, workspaceId),
      advisorUsageSummary(db, workspaceId),
      categoryUsage(db, workspaceId),
    ]);
    res.json({ ...summary, advisors, byCategory });
  });

  router.get('/runs/:id', async (req, res) => {
    const run = await getRun(db, paramId(req));
    if (!run) {
      res.status(404).json({ error: 'Run not found.' });
      return;
    }
    res.json(run);
  });

  router.get('/runs/:id/orchestration', async (req, res) => {
    const orchestration = await loadOrchestration(db, paramId(req));
    if (!orchestration) {
      res.status(404).json({ error: 'This run is not an orchestration.' });
      return;
    }
    res.json(orchestration);
  });

  router.post('/runs/:id/cancel', async (req, res) => {
    const run = await requestCancel(db, paramId(req));
    if (!run) {
      res.status(404).json({ error: 'Run not found.' });
      return;
    }
    res.status(202).json(run);
  });

  router.get('/runs/:id/events', async (req, res) => {
    await streamRunEvents(db, hub, paramId(req), req, res);
  });

  return router;
}

export function statusForError(error: unknown): { status: number; message: string } {
  const approvalStatus = approvalErrorStatus(error);
  if (approvalStatus) return approvalStatus;
  if (
    error instanceof BadRequestError ||
    error instanceof InvalidDefaultError ||
    error instanceof AttachmentError ||
    error instanceof FolderError
  ) {
    return { status: 400, message: error.message };
  }
  if (error instanceof UploadTooLargeError) return { status: 413, message: error.message };
  if (error instanceof TerminalLimitError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof ConversationNotFoundError || error instanceof ConversationMissingError) {
    return { status: 404, message: 'Conversation not found.' };
  }
  if (error instanceof ProjectNotFoundError) return { status: 404, message: error.message };
  if (error instanceof TaskNotFoundError) return { status: 404, message: 'Task not found.' };
  if (error instanceof MessageConflictError || error instanceof ConversationBusyError) {
    return { status: 409, message: error.message };
  }
  return { status: 500, message: 'The server hit an unexpected error. Check the server log.' };
}
