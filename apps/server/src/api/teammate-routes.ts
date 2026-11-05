import { Router, type Request } from 'express';
import type { z } from 'zod';
import {
  createTeammateRequestSchema,
  linkTeammateRequestSchema,
  teammateStarterIdSchema,
  updateTeammateRequestSchema,
  type ProviderId,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { activeConnection } from '../persistence/setup.ts';
import { closeTeammateSessions, linkChat, openHomeThread } from '../persistence/teammate-chats.ts';
import {
  TeammateConflictError,
  TeammateNotFoundError,
  createTeammate,
  deleteTeammate,
  dismissStarter,
  teammateList,
  updateTeammate,
} from '../persistence/teammates.ts';
import { readInstructionsFile } from '../projects/instructions-file.ts';
import { BadRequestError, paramId } from './validation.ts';

export interface TeammateRouteDeps {
  db: Db;
  workspaceId: string;
}

function parseTeammateBody<T>(schema: z.ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues[0]?.message ?? 'Check the Spark’s details.');
  }
  return result.data;
}

const BRIEF_FIELDS: readonly (keyof UpdateTeammateRequest)[] = [
  'name',
  'role',
  'instructions',
  'instructionsPath',
];

async function assertInstructionsFile(requested: string | null | undefined): Promise<void> {
  if (!requested) return;
  const file = await readInstructionsFile(requested);
  if (file.problem) throw new BadRequestError(file.problem);
}

export function teammateErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof TeammateNotFoundError) return { status: 404, message: error.message };
  if (error instanceof TeammateConflictError) return { status: 409, message: error.message };
  return null;
}

export function teammateRoutes({ db, workspaceId }: TeammateRouteDeps): Router {
  const router = Router();

  const assertConnected = async (provider: ProviderId | null | undefined) => {
    if (!provider || (await activeConnection(db, workspaceId, provider))) return;
    throw new BadRequestError('Connect this provider before giving it to a Spark.');
  };

  router.get('/teammates', async (_req, res) => {
    res.json(await teammateList(db, workspaceId));
  });

  router.post('/teammates', async (req, res) => {
    const input = parseTeammateBody(createTeammateRequestSchema, req);
    await assertConnected(input.provider);
    await assertInstructionsFile(input.instructionsPath);
    res.status(201).json(await createTeammate(db, workspaceId, input));
  });

  router.patch('/teammates/:id', async (req, res) => {
    const id = paramId(req);
    const update = parseTeammateBody(updateTeammateRequestSchema, req);
    await assertConnected(update.provider);
    await assertInstructionsFile(update.instructionsPath);
    const saved = await updateTeammate(db, workspaceId, id, update);
    if (BRIEF_FIELDS.some((field) => update[field] !== undefined)) {
      await closeTeammateSessions(db, workspaceId, id);
    }
    res.json(saved);
  });

  router.delete('/teammates/:id', async (req, res) => {
    await deleteTeammate(db, workspaceId, paramId(req));
    res.status(204).end();
  });

  router.post('/teammates/:id/home', async (req, res) => {
    res.json(await openHomeThread(db, workspaceId, paramId(req)));
  });

  router.put('/conversations/:id/teammate', async (req, res) => {
    const { teammateId } = parseTeammateBody(linkTeammateRequestSchema, req);
    res.json(await linkChat(db, workspaceId, paramId(req), teammateId));
  });

  router.post('/teammate-starters/:starter/dismiss', async (req, res) => {
    const starter = teammateStarterIdSchema.safeParse(req.params.starter);
    if (!starter.success) throw new BadRequestError('Unknown starter Spark.');
    await dismissStarter(db, workspaceId, starter.data);
    res.status(204).end();
  });

  return router;
}
