import { Router, type Request, type Response } from 'express';
import {
  artifactShareDaysFor,
  createArtifactShareRequestSchema,
  type ArtifactShareStatus,
} from '@spark-outpost/contracts';
import { BadRequestError, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { ShareDocumentError } from './share-document.ts';
import { ShareServiceError, type ShareService } from './share-service.ts';
import { liveShare } from './share-store.ts';
import { shareTarget, storedUploadKey, type ShareTarget } from './share-target.ts';
import { shownVersion } from './routes.ts';
import {
  AlreadySharedError,
  createShare,
  ShareRefusedError,
  stopShare,
  type ShareDeps,
  type StopDeps,
} from './shares.ts';
import type { StoredVersion } from './store.ts';

export interface ArtifactShareRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  chatFolders?: string;
  shareService?: ShareService | null;
}

const UNAVAILABLE = 'Sharing is not set up in this build of Spark.';
const HOSTED_DAYS =
  'Links from Spark’s shared service last 1 day. Connect your own Cloudflare account for 7 days.';
const NO_UPLOAD_KEY =
  'Spark can’t read your share service’s upload key from the keychain. Connect Cloudflare again in Settings.';

function failed(res: Response, error: unknown): void {
  if (error instanceof AlreadySharedError) {
    res.status(409).json({ error: error.message, share: error.share });
  } else if (error instanceof ShareServiceError) {
    res.status(502).json({ error: error.message });
  } else if (error instanceof ShareDocumentError || error instanceof ShareRefusedError) {
    res.status(409).json({ error: error.message });
  } else {
    throw error;
  }
}

export function artifactShareRoutes({
  db,
  workspaceId,
  secrets,
  chatFolders,
  shareService,
}: ArtifactShareRouteDeps): Router {
  const router = Router();
  const stopDeps: StopDeps | null = shareService ? { db, secrets, service: shareService } : null;

  const target = async (): Promise<ShareTarget | null> =>
    stopDeps && chatFolders ? shareTarget(db, workspaceId, stopDeps.service.origin) : null;

  const shown = async (req: Request, res: Response): Promise<StoredVersion | null> => {
    const stored = await shownVersion(db, workspaceId, req);
    if (!stored) res.status(404).json({ error: 'Artifact not found.' });
    return stored;
  };

  router.get('/artifacts/:id/versions/:version/share', async (req, res) => {
    const stored = await shown(req, res);
    if (!stored) return;
    const to = await target();
    const status: ArtifactShareStatus = {
      available: to !== null,
      service: to?.service ?? null,
      host: to ? new URL(to.origin).host : null,
      days: to ? [...artifactShareDaysFor(to.service)] : [],
      share: await liveShare(db, stored.artifactId, stored.version),
    };
    res.set('Cache-Control', 'no-store').json(status);
  });

  router.post('/artifacts/:id/versions/:version/share', async (req, res) => {
    const choice = parseBody(createArtifactShareRequestSchema, req);
    const to = await target();
    if (!to || !stopDeps || !chatFolders) {
      res.status(503).json({ error: UNAVAILABLE });
      return;
    }
    const stored = await shown(req, res);
    if (!stored) return;
    if (!artifactShareDaysFor(to.service).includes(choice.expiresInDays)) {
      throw new BadRequestError(HOSTED_DAYS);
    }
    const uploadKey = to.service === 'own' ? await storedUploadKey(secrets) : null;
    if (to.service === 'own' && !uploadKey) {
      res.status(409).json({ error: NO_UPLOAD_KEY });
      return;
    }
    const deps: ShareDeps = { ...stopDeps, origin: to.origin, uploadKey, chatFolders };
    try {
      const created = await createShare(deps, stored, choice);
      res.set('Cache-Control', 'no-store').status(201).json(created);
    } catch (error) {
      failed(res, error);
    }
  });

  router.delete('/artifacts/:id/versions/:version/share', async (req, res) => {
    if (!stopDeps) {
      res.status(503).json({ error: UNAVAILABLE });
      return;
    }
    const stored = await shown(req, res);
    if (!stored) return;
    try {
      await stopShare(stopDeps, stored);
      res.status(204).end();
    } catch (error) {
      failed(res, error);
    }
  });

  return router;
}
