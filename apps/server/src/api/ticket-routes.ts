import { Router, type Request } from 'express';
import {
  commentTicketRequestSchema,
  saveTicketConnectionRequestSchema,
  startTicketRequestSchema,
  ticketKeySchema,
  ticketListQuerySchema,
  ticketSourceIdSchema,
  transitionTicketRequestSchema,
  updateTicketSettingsRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { ApiEndpoints } from '../setup/verify.ts';
import {
  changeSettings,
  removeConnection,
  requireSource,
  saveConnection,
  ticketConnections,
  type TicketDeps,
} from '../tickets/connections.ts';
import { listTickets, ticketView } from '../tickets/list.ts';
import { TicketApiError, TicketConflictError, TicketNotConnectedError } from '../tickets/source.ts';
import { startTicket } from '../tickets/start.ts';
import { moveTicket } from '../tickets/sync.ts';
import { resolveRunTarget } from './run-target.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface TicketRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  endpoints: ApiEndpoints;
  fixedRunProvider?: string;
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
const keyParam = (req: Request) =>
  parseOr400(ticketKeySchema.safeParse(req.params.key), 'Use a ticket key such as ENG-12.');

export function ticketRoutes(routeDeps: TicketRouteDeps): Router {
  const deps: TicketDeps = {
    db: routeDeps.db,
    workspaceId: routeDeps.workspaceId,
    secrets: routeDeps.secrets,
    fetch: routeDeps.endpoints.fetch,
    linearApiUrl: routeDeps.linearApiUrl,
  };
  const runTarget = (conversationId: string) => resolveRunTarget(routeDeps, conversationId);
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

  router.get('/tickets/:source/:key', async (req, res) => {
    res.json(await ticketView(deps, sourceParam(req), keyParam(req)));
  });

  router.post('/tickets/:source/:key/start', async (req, res) => {
    const request = parseBody(startTicketRequestSchema, req);
    const started = await startTicket(
      { ...deps, runTarget },
      sourceParam(req),
      keyParam(req),
      request,
    );
    res.status(201).json(started);
  });

  router.post('/tickets/:source/:key/transition', async (req, res) => {
    const { status } = parseBody(transitionTicketRequestSchema, req);
    const open = await requireSource(deps, sourceParam(req));
    res.json(await moveTicket(deps, open, keyParam(req), status, null));
  });

  router.post('/tickets/:source/:key/comments', async (req, res) => {
    const { body } = parseBody(commentTicketRequestSchema, req);
    const source = sourceParam(req);
    const key = keyParam(req);
    const open = await requireSource(deps, source);
    await open.source.comment(key, body);
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source,
      action: 'comment',
      ticketKey: key,
      outcome: 'succeeded',
      detail: { length: body.length },
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
