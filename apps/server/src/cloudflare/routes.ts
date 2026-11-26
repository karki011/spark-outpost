import { Router, type Response } from 'express';
import {
  CLOUDFLARE_DEPLOY_URL,
  CLOUDFLARE_PROBLEMS,
  connectCloudflareRequestSchema,
  shareServiceOrigin,
  updateCloudflareRequestSchema,
  type CloudflareConnection,
  type CloudflareProblem,
} from '@spark-outpost/contracts';
import { storedUploadKey } from '../artifacts/share-target.ts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { CLOUDFLARE_UPLOAD_KEY_SECRET, type SecretStore } from '../setup/secrets.ts';
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
  saveCloudflare,
  setCloudflareSharing,
} from './store.ts';

export interface CloudflareRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  cloudflareCheck?: ServiceCheck;
}

const NOT_CONNECTED = 'Cloudflare is not connected.';
const KEY_NOT_SAVED = 'Spark couldn’t save the upload key in your keychain. Try again.';
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
  let turn: Promise<unknown> = Promise.resolve();

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  const restoreKey = async (previous: string | null) => {
    const restore = previous
      ? secrets.set(CLOUDFLARE_UPLOAD_KEY_SECRET, previous)
      : secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
    await restore.catch(() => undefined);
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
    const saved = await inTurn(async () => {
      const previous = await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET).catch(() => null);
      try {
        await secrets.set(CLOUDFLARE_UPLOAD_KEY_SECRET, parsed.data.uploadKey);
      } catch {
        return false;
      }
      try {
        await saveCloudflare(db, workspaceId, origin, checked.maxDays);
      } catch (error) {
        await restoreKey(previous);
        throw error;
      }
      return true;
    });
    if (!saved) {
      res.status(500).json({ error: KEY_NOT_SAVED });
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
    const row = await cloudflareRow(db, workspaceId);
    if (!row) throw new BadRequestError(NOT_CONNECTED);
    const origin = shareServiceOrigin(row.origin);
    const key = await storedUploadKey(secrets);
    const checked: ServiceCheckResult = !origin
      ? { problem: 'address' }
      : !key
        ? { problem: 'key' }
        : await checkShareService(check, origin, key);
    const maxDays = checked.problem === null ? checked.maxDays : null;
    await recordCloudflareCheck(db, workspaceId, row.origin, checked.problem, maxDays);
    await answer(res);
  });

  router.delete('/cloudflare', async (_req, res) => {
    await inTurn(async () => {
      await secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
      await deleteCloudflare(db, workspaceId);
    });
    res.status(204).end();
  });

  return router;
}
