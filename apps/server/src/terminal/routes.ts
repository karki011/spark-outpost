import { Router } from 'express';
import { z } from 'zod';
import { createTerminalRequestSchema } from '@spark-outpost/contracts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { TerminalSessions } from './sessions.ts';

export function terminalRoutes(sessions: TerminalSessions): Router {
  const router = Router();

  router.post('/terminal/sessions', (req, res) => {
    const { provider, step } = parseBody(createTerminalRequestSchema, req);
    res.status(201).json(sessions.create(provider, step));
  });

  router.delete('/terminal/sessions/:id', (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new BadRequestError('The id must be a UUID.');
    sessions.kill(id.data);
    res.status(204).end();
  });

  return router;
}
