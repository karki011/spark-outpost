import { Router, type Request } from 'express';
import {
  assignTicketRequestSchema,
  commentTicketRequestSchema,
  dismissTicketRequestSchema,
  saveTicketConnectionRequestSchema,
  seenTicketNoticeRequestSchema,
  snoozeTicketRequestSchema,
  startTicketRequestSchema,
  ticketKeyHint,
  ticketKeySchemaFor,
  ticketListQuerySchema,
  ticketSearchQuerySchema,
  ticketSourceIdSchema,
  transitionTicketRequestSchema,
  updateAttentionSettingsSchema,
  updateTicketSettingsRequestSchema,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import {
  getAttentionSettings,
  updateAttentionSettings,
} from '../persistence/attention-settings.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import { assignTicket } from '../tickets/assign.ts';
import {
  changeSettings,
  removeConnection,
  requireSource,
  saveConnection,
  ticketConnections,
  type TicketDeps,
} from '../tickets/connections.ts';
import { loadInbox, reloadInboxMarks } from '../tickets/inbox.ts';
import { listTickets, ticketView } from '../tickets/list.ts';
import { searchTickets } from '../tickets/search.ts';
import { dismissFlags, markNoticeSeen, snoozeProblem, snoozeTicket } from '../tickets/snooze.ts';
import { TicketApiError, TicketConflictError, TicketNotConnectedError } from '../tickets/source.ts';
import { startTicket } from '../tickets/start.ts';
import { moveOptions } from '../tickets/move-options.ts';
import { moveTicket } from '../tickets/sync.ts';
import { sparkToolsOffered, type AgentRuntime } from '../agents/acp/spark-tools.ts';
import { resolveRunTarget } from './run-target.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface TicketRouteDeps extends GitHubRouteDeps {
  fixedRunProvider?: string;
  agentRuntime?: AgentRuntime;
  linearApiUrl?: string | undefined;
}

export function ticketErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof TicketNotConnectedError || error instanceof TicketConflictError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof TicketApiError) {
    if (error.status === 404) return { status: 404, message: error.message };
    return { status: error.status === 401 ? 400 : 502, message: error.message };
  }
  return null;
}

function parseOr400<T>(result: { success: true; data: T } | { success: false }, message: string) {
  if (!result.success) throw new BadRequestError(message);
  return result.data;
}

const sourceParam = (req: Request) =>
  parseOr400(ticketSourceIdSchema.safeParse(req.params.source), 'Unknown ticket source.');
const keyParam = (req: Request, source: TicketSourceId) =>
  parseOr400(ticketKeySchemaFor(source).safeParse(req.params.key), ticketKeyHint(source));
const ticketRef = (req: Request) => {
  const source = sourceParam(req);
  return { source, key: keyParam(req, source) };
};

export function ticketRoutes(routeDeps: TicketRouteDeps): Router {
  const deps: TicketDeps = {
    db: routeDeps.db,
    workspaceId: routeDeps.workspaceId,
    secrets: routeDeps.secrets,
    fetch: routeDeps.endpoints.fetch,
    linearApiUrl: routeDeps.linearApiUrl,
  };
  const runTarget = (conversationId: string) => resolveRunTarget(routeDeps, conversationId);
  const offersSparkTools = (provider: string) =>
    sparkToolsOffered(routeDeps.agentRuntime ?? 'fake', provider);
  const router = Router();

  router.get('/tickets/connections', async (_req, res) => {
    res.json(await ticketConnections(deps));
  });

  router.put('/tickets/connections/:source', async (req, res) => {
    const request = parseBody(saveTicketConnectionRequestSchema, req);
    if (request.source !== sourceParam(req)) {
      throw new BadRequestError('The body names a different source.');
    }
    res.json(await saveConnection(deps, request));
  });

  router.patch('/tickets/connections/:source', async (req, res) => {
    const settings = parseBody(updateTicketSettingsRequestSchema, req);
    res.json(await changeSettings(deps, sourceParam(req), settings));
  });

  router.get('/tickets/connections/:source/move-options', async (req, res) => {
    res.json(await moveOptions(await requireSource(deps, sourceParam(req))));
  });

  router.delete('/tickets/connections/:source', async (req, res) => {
    res.json(await removeConnection(deps, sourceParam(req)));
  });

  router.get('/tickets', async (req, res) => {
    const query = parseOr400(
      ticketListQuerySchema.safeParse(req.query),
      'Check the ticket filters.',
    );
    res.json(await listTickets(deps, query));
  });

  router.get('/tickets/inbox', async (req, res) => {
    const refresh = req.get('cache-control')?.includes('no-cache') === true;
    res.json(await loadInbox({ ...deps, github: gitHubDepsOf(routeDeps) }, { refresh }));
  });

  router.get('/tickets/search', async (req, res) => {
    const query = parseOr400(
      ticketSearchQuerySchema.safeParse(req.query),
      'Check the search and its filters.',
    );
    res.json(await searchTickets(deps, query));
  });

  router.get('/tickets/attention-settings', async (_req, res) => {
    res.json(await getAttentionSettings(deps.db, deps.workspaceId));
  });

  router.patch('/tickets/attention-settings', async (req, res) => {
    const update = parseBody(updateAttentionSettingsSchema, req);
    res.json(await updateAttentionSettings(deps.db, deps.workspaceId, update));
  });

  router.post('/tickets/:source/:key/assign', async (req, res) => {
    const request = parseBody(assignTicketRequestSchema, req);
    const { source, key } = ticketRef(req);
    res.json(await assignTicket(deps, source, key, request));
  });

  router.get('/tickets/:source/:key', async (req, res) => {
    const github = gitHubDepsOf(routeDeps);
    const { source, key } = ticketRef(req);
    res.json(await ticketView({ ...deps, github }, source, key));
  });

  router.post('/tickets/:source/:key/start', async (req, res) => {
    const request = parseBody(startTicketRequestSchema, req);
    const { source, key } = ticketRef(req);
    const started = await startTicket(
      { ...deps, runTarget, offersSparkTools },
      source,
      key,
      request,
    );
    res.status(201).json(started);
  });

  router.post('/tickets/:source/:key/transition', async (req, res) => {
    const { status } = parseBody(transitionTicketRequestSchema, req);
    const source = sourceParam(req);
    const open = await requireSource(deps, source);
    res.json(await moveTicket(deps, open, keyParam(req, source), { group: status }, null));
  });

  router.put('/tickets/:source/:key/snooze', async (req, res) => {
    const request = parseBody(snoozeTicketRequestSchema, req);
    const problem = snoozeProblem(new Date(request.until), new Date());
    if (problem) throw new BadRequestError(problem);
    await snoozeTicket(deps, ticketRef(req), request);
    res.json(await reloadInboxMarks({ ...deps, github: gitHubDepsOf(routeDeps) }, ticketRef(req)));
  });

  router.delete('/tickets/:source/:key/snooze', async (req, res) => {
    await snoozeTicket(deps, ticketRef(req), null);
    res.json(await reloadInboxMarks({ ...deps, github: gitHubDepsOf(routeDeps) }, ticketRef(req)));
  });

  router.put('/tickets/:source/:key/dismiss', async (req, res) => {
    const { flags } = parseBody(dismissTicketRequestSchema, req);
    await dismissFlags(deps, ticketRef(req), flags);
    res.json(await reloadInboxMarks({ ...deps, github: gitHubDepsOf(routeDeps) }, ticketRef(req)));
  });

  router.delete('/tickets/:source/:key/dismiss', async (req, res) => {
    await dismissFlags(deps, ticketRef(req), []);
    res.json(await reloadInboxMarks({ ...deps, github: gitHubDepsOf(routeDeps) }, ticketRef(req)));
  });

  router.put('/tickets/:source/:key/notice-seen', async (req, res) => {
    const { notice } = parseBody(seenTicketNoticeRequestSchema, req);
    await markNoticeSeen(deps, ticketRef(req), notice);
    res.json({ ok: true });
  });

  router.post('/tickets/:source/:key/comments', async (req, res) => {
    const { body, visibility } = parseBody(commentTicketRequestSchema, req);
    const { source, key } = ticketRef(req);
    const open = await requireSource(deps, source);
    if (visibility === 'customer') {
      if (!open.source.customerComment) {
        throw new BadRequestError('Only ServiceNow has comments the caller sees.');
      }
      await open.source.customerComment(key, body);
    } else {
      await open.source.comment(key, body);
    }
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source,
      action: 'comment',
      ticketKey: key,
      outcome: 'succeeded',
      detail: { length: body.length, visibility: visibility ?? 'internal' },
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
