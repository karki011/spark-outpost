import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createShellRequestSchema,
  createTerminalRequestSchema,
  type CreateShellResponse,
  type ShellBusyResponse,
} from '@spark-outpost/contracts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { Queryable } from '../persistence/db.ts';
import { catalogEntry } from '../providers/catalog.ts';
import type { TerminalSessions } from './sessions.ts';
import { shellFolder } from './shell-folder.ts';

export interface TerminalRouteDeps {
  db: Queryable;
  workspaceId: string;
  terminals: TerminalSessions;
}

function sessionId(req: Request): string {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw new BadRequestError('The id must be a UUID.');
  return id.data;
}

export function terminalRoutes({ db, workspaceId, terminals }: TerminalRouteDeps): Router {
  const router = Router();

  router.post('/terminal/sessions', (req, res) => {
    const { provider, step } = parseBody(createTerminalRequestSchema, req);
    const entry = catalogEntry(provider);
    if (!entry.methods.includes('cli')) {
      throw new BadRequestError(`${entry.name} has no CLI to set up. Connect it with an API key.`);
    }
    res.status(201).json(terminals.create(provider, step));
  });

  router.post('/terminal/shells', async (req, res) => {
    const { conversationId } = parseBody(createShellRequestSchema, req);
    const folder = await shellFolder(db, workspaceId, conversationId);
    const created = terminals.createShell({
      cwd: folder.cwd,
      conversationId,
      label: folder.label,
    });
    const response: CreateShellResponse = { ...created, ...folder };
    res.status(201).json(response);
  });

  router.get('/terminal/sessions/:id/busy', (req, res) => {
    const response: ShellBusyResponse = { command: terminals.runningCommand(sessionId(req)) };
    res.json(response);
  });

  router.delete('/terminal/sessions/:id', (req, res) => {
    terminals.kill(sessionId(req));
    res.status(204).end();
  });

  return router;
}
