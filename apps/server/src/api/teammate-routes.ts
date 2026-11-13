import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createTeammateRequestSchema,
  crewPathSchema,
  linkTeammateRequestSchema,
  saveCrewFileSchema,
  teammateStarterIdSchema,
  updateTeammateRequestSchema,
  type ProviderId,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import { crewSparksDir } from '../crew/folders.ts';
import {
  CrewFileConflictError,
  CrewFileNotFoundError,
  CrewFileProblemError,
  deleteCrewFile,
  readCrewFile,
  saveCrewFile,
} from '../crew/spark-folder.ts';
import { sparkFolder } from '../crew/spark-skills.ts';
import type { Db } from '../persistence/db.ts';
import { activeConnection } from '../persistence/setup.ts';
import { closeTeammateSessions, linkChat, openHomeThread } from '../persistence/teammate-chats.ts';
import {
  TeammateConflictError,
  TeammateNotFoundError,
  createTeammate,
  deleteTeammate,
  dismissStarter,
  getTeammate,
  teammateList,
  updateTeammate,
} from '../persistence/teammates.ts';
import { readInstructionsFile } from '../projects/instructions-file.ts';
import { BadRequestError, paramId } from './validation.ts';

export interface TeammateRouteDeps {
  db: Db;
  workspaceId: string;
  sparksDir?: string;
}

const filePathQuerySchema = z.object({ path: crewPathSchema });

function filePath(req: Request): string {
  const parsed = filePathQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new BadRequestError('Name a file inside the Spark folder.');
  return parsed.data.path;
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
  if (error instanceof CrewFileNotFoundError) return { status: 404, message: error.message };
  if (error instanceof CrewFileConflictError) return { status: 409, message: error.message };
  if (error instanceof CrewFileProblemError) return { status: 400, message: error.message };
  return null;
}

export function teammateRoutes({
  db,
  workspaceId,
  sparksDir = crewSparksDir(),
}: TeammateRouteDeps): Router {
  const router = Router();

  const sparkId = async (req: Request) => {
    const id = paramId(req);
    await getTeammate(db, workspaceId, id, sparksDir);
    return id;
  };

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
    res.status(201).json(await createTeammate(db, workspaceId, input, sparksDir));
  });

  router.patch('/teammates/:id', async (req, res) => {
    const id = paramId(req);
    const update = parseTeammateBody(updateTeammateRequestSchema, req);
    await assertConnected(update.provider);
    await assertInstructionsFile(update.instructionsPath);
    const saved = await updateTeammate(db, workspaceId, id, update, sparksDir);
    if (BRIEF_FIELDS.some((field) => update[field] !== undefined)) {
      await closeTeammateSessions(db, workspaceId, id);
    }
    res.json(saved);
  });

  router.delete('/teammates/:id', async (req, res) => {
    await deleteTeammate(db, workspaceId, paramId(req), sparksDir);
    res.status(204).end();
  });

  router.get('/teammates/:id/folder', async (req, res) => {
    res.json(await sparkFolder(sparksDir, await sparkId(req)));
  });

  router.get('/teammates/:id/files', async (req, res) => {
    res.json(await readCrewFile(sparksDir, await sparkId(req), filePath(req)));
  });

  router.put('/teammates/:id/files', async (req, res) => {
    const id = await sparkId(req);
    const input = parseTeammateBody(saveCrewFileSchema, req);
    const saved = await saveCrewFile(sparksDir, id, input);
    await closeTeammateSessions(db, workspaceId, id);
    res.json(saved);
  });

  router.delete('/teammates/:id/files', async (req, res) => {
    const id = await sparkId(req);
    await deleteCrewFile(sparksDir, id, filePath(req));
    await closeTeammateSessions(db, workspaceId, id);
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
