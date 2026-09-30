import { Router } from 'express';
import { linkChatTicketRequestSchema } from '@spark-outpost/contracts';
import {
  chatTicketView,
  dismissChatTicketSuggestions,
  linkChatTicket,
  unlinkChatTicket,
} from '../tickets/chat-link.ts';
import { warmMentionedTickets } from '../tickets/mention-cache.ts';
import type { TicketDeps } from '../tickets/connections.ts';
import type { TicketRouteDeps } from './ticket-routes.ts';
import { paramId, parseBody } from './validation.ts';

function ticketDepsOf(deps: TicketRouteDeps): TicketDeps {
  return {
    db: deps.db,
    workspaceId: deps.workspaceId,
    secrets: deps.secrets,
    fetch: deps.endpoints.fetch,
    linearApiUrl: deps.linearApiUrl,
  };
}

export function ticketMentionWarmer(deps: TicketRouteDeps) {
  const ticketDeps = ticketDepsOf(deps);
  return async (content: string): Promise<void> => {
    await warmMentionedTickets(ticketDeps, content).catch((error: unknown) => {
      console.error('Looking up the tickets a message mentions failed', error);
    });
  };
}

export function chatTicketRoutes(routeDeps: TicketRouteDeps): Router {
  const deps = ticketDepsOf(routeDeps);
  const router = Router();

  router.get('/conversations/:id/tickets', async (req, res) => {
    res.json(await chatTicketView(deps.db, paramId(req)));
  });

  router.post('/conversations/:id/tickets', async (req, res) => {
    const request = parseBody(linkChatTicketRequestSchema, req);
    res.json(await linkChatTicket(deps, paramId(req), request));
  });

  router.post('/conversations/:id/tickets/unlink', async (req, res) => {
    const request = parseBody(linkChatTicketRequestSchema, req);
    res.json(await unlinkChatTicket(deps, paramId(req), request));
  });

  router.post('/conversations/:id/tickets/dismiss', async (req, res) => {
    res.json(await dismissChatTicketSuggestions(deps, paramId(req)));
  });

  return router;
}
