import { SteerError } from '../coordinator/steer.ts';
import { Router } from 'express';
import {
  CONVERSATION_SEARCH_MAX_LENGTH,
  PERMISSION_DO,
  createConversationRequestSchema,
  sendMessageRequestSchema,
  type ActiveRuns,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  ConversationNotFoundError,
  MessageConflictError,
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../persistence/conversations.ts';
import { AnnotationError, listAnnotations } from '../persistence/annotations.ts';
import { countActiveRuns, getRun } from '../persistence/runs.ts';
import { stopRun } from '../workflow/stop-run.ts';
import { loadOrchestration } from '../persistence/orchestrations.ts';
import { advisorUsageSummary } from '../persistence/advice.ts';
import { usageSummary } from '../persistence/usage.ts';
import { categoryUsage } from '../persistence/category-usage.ts';
import { ConversationMissingError } from '../persistence/chat-settings.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import { TerminalLimitError } from '../terminal/sessions.ts';
import type { RunEventHub } from './run-event-hub.ts';
import { streamRunEvents } from './run-stream.ts';
import { AttachmentError } from '../persistence/attachment-content.ts';
import { FolderError } from '../projects/folders.ts';
import { ProjectNotFoundError } from '../projects/projects.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { BadRequestError, UploadTooLargeError, paramId, parseBody } from './validation.ts';
import { outcomeErrorStatus } from './outcome-routes.ts';
import { approvalErrorStatus } from './approval-routes.ts';
import { shipErrorStatus } from './ship-routes.ts';
import { ticketErrorStatus } from './ticket-routes.ts';
import { slackErrorStatus } from './slack-routes.ts';
import { teammateErrorStatus } from './teammate-routes.ts';
import { queueErrorStatus } from './queue-routes.ts';
import { interruptionErrorStatus } from './interruption-routes.ts';
import { resolveRunTarget } from './run-target.ts';
import { PlanDocumentError } from '../persistence/plan-documents.ts';
import { AgentConfigConflictError } from './agent-config-routes.ts';
import { KeychainWaitingError } from '../setup/keychain.ts';
import { ChatNotFoundError } from '../chat-share/digest.ts';

export interface RouteDeps {
  db: Db;
  hub: RunEventHub;
  workspaceId: string;
  fixedRunProvider?: string;
  warmTicketMentions?: (content: string) => Promise<void>;
}

export function apiRoutes(deps: RouteDeps): Router {
  const { db, hub, workspaceId, fixedRunProvider } = deps;
  const router = Router();

  const runTarget = (conversationId: string) =>
    resolveRunTarget({ db, workspaceId, fixedRunProvider }, conversationId);

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
    if (request.startAs && target.permission !== PERMISSION_DO) {
      throw new BadRequestError('Switch the chat to Do to make the change.');
    }
    await deps.warmTicketMentions?.(request.content);
    res.status(201).json(await sendUserMessage(db, conversationId, request, target, workspaceId));
  });

  router.get('/conversations/:id/annotations', async (req, res) => {
    res.json({ annotations: await listAnnotations(db, paramId(req)) });
  });

  router.get('/usage/summary', async (_req, res) => {
    const [summary, advisors, byCategory] = await Promise.all([
      usageSummary(db, workspaceId),
      advisorUsageSummary(db, workspaceId),
      categoryUsage(db, workspaceId),
    ]);
    res.json({ ...summary, advisors, byCategory });
  });

  router.get('/runs/active', async (_req, res) => {
    const activeRuns: ActiveRuns = { activeRuns: await countActiveRuns(db) };
    res.json(activeRuns);
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
    const stopped = await stopRun(db, paramId(req));
    if (!stopped) {
      res.status(404).json({ error: 'Run not found.' });
      return;
    }
    res
      .status(stopped.outcome === 'stopping' ? 202 : 200)
      .set('Spark-Stop', stopped.outcome)
      .json(stopped.run);
  });

  router.get('/runs/:id/events', async (req, res) => {
    await streamRunEvents(db, hub, paramId(req), req, res);
  });

  return router;
}

export function statusForError(error: unknown): { status: number; message: string } {
  const known =
    approvalErrorStatus(error) ??
    outcomeErrorStatus(error) ??
    shipErrorStatus(error) ??
    ticketErrorStatus(error) ??
    slackErrorStatus(error) ??
    teammateErrorStatus(error) ??
    queueErrorStatus(error) ??
    interruptionErrorStatus(error);
  if (known) return known;
  if (
    error instanceof BadRequestError ||
    error instanceof InvalidDefaultError ||
    error instanceof AttachmentError ||
    error instanceof AnnotationError ||
    error instanceof FolderError
  ) {
    return { status: 400, message: error.message };
  }
  if (error instanceof UploadTooLargeError) return { status: 413, message: error.message };
  if (error instanceof KeychainWaitingError) return { status: 503, message: error.message };
  if (error instanceof SteerError) return { status: error.status, message: error.message };
  if (error instanceof TerminalLimitError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof ConversationNotFoundError || error instanceof ConversationMissingError) {
    return { status: 404, message: 'Conversation not found.' };
  }
  if (error instanceof ProjectNotFoundError || error instanceof ChatNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof TaskNotFoundError) return { status: 404, message: 'Task not found.' };
  if (error instanceof PlanDocumentError || error instanceof AgentConfigConflictError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof MessageConflictError) {
    return { status: 409, message: error.message };
  }
  return { status: 500, message: 'The server hit an unexpected error. Check the server log.' };
}
