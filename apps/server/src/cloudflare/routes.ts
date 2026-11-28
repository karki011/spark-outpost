import { readFile } from 'node:fs/promises';
import { Router, type Response } from 'express';
import {
  CLOUDFLARE_DEPLOY_URL,
  CLOUDFLARE_PROBLEMS,
  connectCloudflareRequestSchema,
  startCloudflareReachRequestSchema,
  shareServiceOrigin,
  updateCloudflareRequestSchema,
  type CloudflareConnection,
  type CloudflareProblem,
} from '@spark-outpost/contracts';
import { storedUploadKey } from '../artifacts/share-target.ts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { CLOUDFLARE_UPLOAD_KEY_SECRET, type SecretStore } from '../setup/secrets.ts';
import type { CloudflareClientConfig } from './client.ts';
import { createCloudflareLink } from './link.ts';
import { createCloudflareReach } from './reach.ts';
import { createCloudflareSetup, type CloudflareSetupDeps } from './setup.ts';
import { SETUP_KEY_NOT_SAVED, StepFailure } from './setup-problems.ts';
import { createTunnelRunner, type TunnelRunner } from './tunnel-runner.ts';
import {
  checkShareService,
  CLOUDFLARE_CHECK_TIMEOUT_MS,
  type ServiceCheck,
  type ServiceCheckResult,
} from './check.ts';
import {
  cloudflareRow,
  deleteCloudflare,
  liveSharesOn,
  recordCloudflareCheck,
  setCloudflareSharing,
} from './store.ts';

export interface CloudflareRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  cloudflareCheck?: ServiceCheck;
  cloudflareClient?: CloudflareClientConfig | null;
  cloudflareSetup?: Partial<Pick<CloudflareSetupDeps, 'fetch' | 'readWorker' | 'sleep'>>;
  port: number;
  cloudflaredBin?: string | null;
  tunnelRunner?: TunnelRunner | null;
  cloudflareBoot?: boolean;
}

const NOT_CONNECTED = 'Cloudflare is not connected.';
const PROBLEM_STATUS: Record<CloudflareProblem, number> = {
  address: 400,
  key: 400,
  unreachable: 502,
  notService: 502,
  refused: 400,
  open: 400,
};

const isProblem = (value: string | null): value is CloudflareProblem =>
  value !== null && Object.hasOwn(CLOUDFLARE_PROBLEMS, value);

function refuse(res: Response, problem: CloudflareProblem): void {
  res.status(PROBLEM_STATUS[problem]).json({ error: CLOUDFLARE_PROBLEMS[problem], problem });
}

export function cloudflareRoutes(deps: CloudflareRouteDeps): Router {
  const { db, workspaceId, secrets } = deps;
  const check = deps.cloudflareCheck ?? { fetch, timeoutMs: CLOUDFLARE_CHECK_TIMEOUT_MS };
  const router = Router();
  const link = createCloudflareLink({ db, workspaceId, secrets });
  const { inTurn } = link;
  const setup = createCloudflareSetup({
    client: deps.cloudflareClient ?? null,
    fetch,
    readWorker: (file) => readFile(file, 'utf8'),
    ...deps.cloudflareSetup,
    link,
    check,
  });

  const runner =
    deps.tunnelRunner !== undefined
      ? deps.tunnelRunner
      : deps.cloudflaredBin
        ? createTunnelRunner({ bin: deps.cloudflaredBin })
        : null;
  const reach = createCloudflareReach({
    db,
    workspaceId,
    secrets,
    client: deps.cloudflareClient ?? null,
    runner,
    forwardTo: `http://127.0.0.1:${deps.port}`,
    fetch: deps.cloudflareSetup?.fetch ?? fetch,
  });
  if (deps.cloudflareBoot) reach.boot();

  const answerReach = async (res: Response, work: () => Promise<unknown>) => {
    try {
      res.set('Cache-Control', 'no-store').json(await work());
    } catch (error) {
      if (error instanceof StepFailure) throw new BadRequestError(error.message);
      throw error;
    }
  };

  const connection = async (): Promise<CloudflareConnection> => {
    const row = await cloudflareRow(db, workspaceId);
    const origin = row ? shareServiceOrigin(row.origin) : null;
    return {
      connected: row !== null,
      origin,
      host: origin ? new URL(origin).host : null,
      shareArtifacts: row?.shareArtifacts ?? true,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      problem: row && isProblem(row.problem) ? CLOUDFLARE_PROBLEMS[row.problem] : null,
      sharedNow: origin ? await liveSharesOn(db, origin) : 0,
      deployUrl: CLOUDFLARE_DEPLOY_URL,
    };
  };

  const answer = async (res: Response) => {
    res.set('Cache-Control', 'no-store').json(await connection());
  };

  router.get('/cloudflare', async (_req, res) => {
    await answer(res);
  });

  router.put('/cloudflare', async (req, res) => {
    const parsed = connectCloudflareRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const badKey = parsed.error.issues.every((issue) => issue.path[0] === 'uploadKey');
      refuse(res, badKey ? 'key' : 'address');
      return;
    }
    const origin = shareServiceOrigin(parsed.data.address);
    if (!origin) {
      refuse(res, 'address');
      return;
    }
    const checked = await checkShareService(check, origin, parsed.data.uploadKey);
    if (checked.problem) {
      refuse(res, checked.problem);
      return;
    }
    const saved = await link.save(origin, parsed.data.uploadKey, checked.maxDays);
    if (!saved) {
      res.status(500).json({ error: SETUP_KEY_NOT_SAVED });
      return;
    }
    await answer(res);
  });

  router.patch('/cloudflare', async (req, res) => {
    const { shareArtifacts } = parseBody(updateCloudflareRequestSchema, req);
    if (!(await setCloudflareSharing(db, workspaceId, shareArtifacts))) {
      throw new BadRequestError(NOT_CONNECTED);
    }
    await answer(res);
  });

  router.post('/cloudflare/check', async (_req, res) => {
    const { row, key } = await inTurn(async () => ({
      row: await cloudflareRow(db, workspaceId),
      key: await storedUploadKey(secrets),
    }));
    if (!row) throw new BadRequestError(NOT_CONNECTED);
    const origin = shareServiceOrigin(row.origin);
    const checked: ServiceCheckResult = !origin
      ? { problem: 'address' }
      : !key
        ? { problem: 'key' }
        : await checkShareService(check, origin, key);
    const maxDays = checked.problem === null ? checked.maxDays : null;
    await recordCloudflareCheck(db, workspaceId, row.origin, checked.problem, maxDays);
    await answer(res);
  });

  router.get('/cloudflare/setup', (_req, res) => {
    res.set('Cache-Control', 'no-store').json(setup.view());
  });

  router.post('/cloudflare/setup', async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await setup.start());
    } catch (error) {
      if (error instanceof StepFailure) throw new BadRequestError(error.message);
      throw error;
    }
  });

  router.delete('/cloudflare/setup', async (_req, res) => {
    const cancelled = await setup.cancel();
    await inTurn(() => Promise.resolve());
    res.set('Cache-Control', 'no-store').json(cancelled);
  });

  router.get('/cloudflare/reach', async (_req, res) => {
    await reach.reconcile();
    res.set('Cache-Control', 'no-store').json(reach.view());
  });

  router.post('/cloudflare/reach', async (req, res) => {
    const request = parseBody(startCloudflareReachRequestSchema, req);
    await answerReach(res, () => reach.start(request));
  });

  router.post('/cloudflare/reach/resume', async (_req, res) => {
    await answerReach(res, () => reach.resume());
  });

  router.delete('/cloudflare/reach/setup', async (_req, res) => {
    await answerReach(res, () => reach.cancel());
  });

  router.delete('/cloudflare/reach', async (_req, res) => {
    await answerReach(res, () => reach.remove());
  });

  router.delete('/cloudflare', async (_req, res) => {
    await setup.cancel();
    await inTurn(async () => {
      await secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
      await deleteCloudflare(db, workspaceId);
    });
    res.status(204).end();
  });

  return router;
}
