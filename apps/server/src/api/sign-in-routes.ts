import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createSignInRequestSchema,
  updateSignInRequestSchema,
  type SignInList,
} from '@spark-outpost/contracts';
import {
  SignInProblem,
  createSignIn,
  deleteSignIn,
  listSignIns,
  updateSignIn,
} from '../browser/sign-ins.ts';
import { SignInLabelTakenError } from '../persistence/browser-sign-ins.ts';
import type { Db } from '../persistence/db.ts';
import { getProject } from '../projects/projects.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface SignInRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
}

const signInParam = z.uuid();

function signInId(req: Request): string {
  const parsed = signInParam.safeParse(req.params.signInId);
  if (!parsed.success) throw new BadRequestError('The id must be a UUID.');
  return parsed.data;
}

async function plainly<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof SignInProblem || error instanceof SignInLabelTakenError) {
      throw new BadRequestError(error.message);
    }
    throw error;
  }
}

export function signInRoutes({ db, workspaceId, secrets }: SignInRouteDeps): Router {
  const router = Router();
  const deps = { db, secrets };

  const projectId = async (req: Request) => (await getProject(db, workspaceId, paramId(req))).id;

  router.get('/projects/:id/sign-ins', async (req, res) => {
    const response: SignInList = { signIns: await listSignIns(deps, await projectId(req)) };
    res.json(response);
  });

  router.post('/projects/:id/sign-ins', async (req, res) => {
    const body = parseBody(createSignInRequestSchema, req);
    res.status(201).json(await plainly(createSignIn(deps, await projectId(req), body)));
  });

  router.put('/projects/:id/sign-ins/:signInId', async (req, res) => {
    const body = parseBody(updateSignInRequestSchema, req);
    const saved = await plainly(updateSignIn(deps, await projectId(req), signInId(req), body));
    res.json(saved);
  });

  router.delete('/projects/:id/sign-ins/:signInId', async (req, res) => {
    await deleteSignIn(deps, await projectId(req), signInId(req));
    res.status(204).end();
  });

  return router;
}
