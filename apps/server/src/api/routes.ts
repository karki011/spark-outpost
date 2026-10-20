import { remoteDeviceOf } from '../remote/principal.ts';
import { Router } from 'express';
import {
  CONVERSATION_SEARCH_MAX_LENGTH,
  createConversationRequestSchema,
  sendMessageRequestSchema,
  type ActiveRuns,
  type PlanUsageList,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import {
  ConversationNotFoundError,
  MessageConflictError,
  createConversation,
  getConversationDetail,
  listConversations,
  sendUserMessage,
} from '../persistence/conversations.ts';
import { AnnotationError, listAnnotations } from '../persistence/annotations.ts';
import { reasoningText } from '../persistence/run-events.ts';
import { countActiveRuns, getRun } from '../persistence/runs.ts';
import { commandOutput } from '../persistence/run-commands.ts';
import { stopRun } from '../workflow/stop-run.ts';
import { isTerminalRun } from '../persistence/native-terminal-turns.ts';
import { loadOrchestration } from '../persistence/orchestrations.ts';
import { advisorUsageSummary } from '../persistence/advice.ts';
import { EMPTY_USAGE_SUMMARY, usageSummary } from '../persistence/usage.ts';
import { planUsage } from '../usage/plan-limits.ts';
import { assistantConversationId } from '../companion/assistant-settings.ts';
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
import {
  BadRequestError,
  RequestTooLargeError,
  UploadTooLargeError,
  paramId,
  parseBody,
} from './validation.ts';
import { outcomeErrorStatus } from './outcome-routes.ts';
import { approvalErrorStatus } from './approval-routes.ts';
import { shipErrorStatus } from './ship-routes.ts';
import { cloneErrorStatus } from './project-clone-routes.ts';
import { ticketErrorStatus } from './ticket-routes.ts';
import { slackErrorStatus } from './slack-routes.ts';
import { teammateErrorStatus } from './teammate-routes.ts';
import { queueErrorStatus } from './queue-routes.ts';
import { adoptErrorStatus } from './adopt-pull-routes.ts';
import { outpostErrorStatus } from './outpost-routes.ts';
import { interruptionErrorStatus } from './interruption-routes.ts';
import { resolveRunTarget } from './run-target.ts';
import { PlanDocumentError } from '../persistence/plan-documents.ts';
import { AgentConfigConflictError } from './agent-config-routes.ts';
import { KeychainWaitingError } from '../setup/keychain.ts';
import { ChatNotFoundError } from '../chat-share/digest.ts';
import type { NativeRuntime } from '../terminal/native-runtime.ts';
import { NativeTerminalConflictError } from '../persistence/native-terminal-turns.ts';

export interface RouteDeps {
  db: Db;
  hub: RunEventHub;
  workspaceId: string;
  fixedRunProvider?: string;
  warmTicketMentions?: (content: string) => Promise<void>;
  nativeTerminals?: NativeRuntime;
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
    const { id, ...options } = parseBody(createConversationRequestSchema, req);
    res
      .status(201)
      .json(
        await withTransaction(db, (client) => createConversation(client, workspaceId, id, options)),
      );
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
    await deps.warmTicketMentions?.(request.content);
    res.status(201).json(await sendUserMessage(db, conversationId, request, target, workspaceId));
  });

  router.get('/conversations/:id/annotations', async (req, res) => {
    res.json({ annotations: await listAnnotations(db, paramId(req)) });
  });

  router.get('/usage/summary', async (req, res) => {
    const assistant = req.query.scope === 'assistant';
    const only = assistant ? await assistantConversationId(db, workspaceId) : null;
    if (assistant && !only) {
      res.json(EMPTY_USAGE_SUMMARY);
      return;
    }
    const [summary, advisors, byCategory] = await Promise.all([
      usageSummary(db, workspaceId, only),
      assistant ? EMPTY_USAGE_SUMMARY.advisors : advisorUsageSummary(db, workspaceId),
      categoryUsage(db, workspaceId, only),
    ]);
    res.json({ ...summary, advisors, byCategory });
  });

  router.get('/usage/plan-limits', async (_req, res) => {
    const list: PlanUsageList = { plans: await planUsage(db, workspaceId) };
    res.json(list);
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
    if (remoteDeviceOf(res) && (await isTerminalRun(db, paramId(req)))) {
      res.status(409).json({ error: 'Use Stop in the Terminal session to interrupt the agent.' });
      return;
    }
    let stopped = await stopRun(db, paramId(req));
    if (stopped && (await deps.nativeTerminals?.stopRun(paramId(req))))
      stopped = await stopRun(db, paramId(req));
    if (!stopped) {
      res.status(404).json({ error: 'Run not found.' });
      return;
    }
    res
      .status(stopped.outcome === 'stopping' ? 202 : 200)
      .set('Spark-Stop', stopped.outcome)
      .json(stopped.run);
  });

  router.get('/runs/:id/commands/:commandId/output', async (req, res) => {
    const output = await commandOutput(db, paramId(req), paramId(req, 'commandId'));
    if (!output) {
      res.status(404).json({ error: 'Command not found.' });
      return;
    }
    res.json(output);
  });

  router.get('/runs/:id/reasoning/:messageId', async (req, res) => {
    const thought = await reasoningText(db, paramId(req), paramId(req, 'messageId'));
    if (!thought) {
      res.status(404).json({ error: 'Thinking not found.' });
      return;
    }
    res.json(thought);
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
    adoptErrorStatus(error) ??
    outpostErrorStatus(error) ??
    cloneErrorStatus(error) ??
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
  if (error instanceof UploadTooLargeError || error instanceof RequestTooLargeError) {
    return { status: 413, message: error.message };
  }
  if (error instanceof KeychainWaitingError) return { status: 503, message: error.message };
  if (error instanceof TerminalLimitError || error instanceof NativeTerminalConflictError) {
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
