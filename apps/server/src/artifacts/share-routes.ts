import { Router, type Request, type Response } from 'express';
import {
  createArtifactShareRequestSchema,
  type ArtifactShareStatus,
} from '@spark-outpost/contracts';
import { parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { ShareDocumentError } from './share-document.ts';
import { ShareServiceError, type ShareService } from './share-service.ts';
import { liveShare } from './share-store.ts';
import { shownVersion } from './routes.ts';
import {
  AlreadySharedError,
  createShare,
  ShareRefusedError,
  stopShare,
  type ShareDeps,
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
  const deps: ShareDeps | null =
    shareService && chatFolders ? { db, secrets, service: shareService, chatFolders } : null;

  const shown = async (req: Request, res: Response): Promise<StoredVersion | null> => {
    const stored = await shownVersion(db, workspaceId, req);
    if (!stored) res.status(404).json({ error: 'Artifact not found.' });
    return stored;
  };

  const sharing = async (
    req: Request,
    res: Response,
  ): Promise<{ deps: ShareDeps; stored: StoredVersion } | null> => {
    if (!deps) {
      res.status(503).json({ error: UNAVAILABLE });
      return null;
    }
    const stored = await shown(req, res);
    return stored ? { deps, stored } : null;
  };

  router.get('/artifacts/:id/versions/:version/share', async (req, res) => {
    const stored = await shown(req, res);
    if (!stored) return;
    const status: ArtifactShareStatus = {
      available: deps !== null,
      share: await liveShare(db, stored.artifactId, stored.version),
    };
    res.set('Cache-Control', 'no-store').json(status);
  });

  router.post('/artifacts/:id/versions/:version/share', async (req, res) => {
    const choice = parseBody(createArtifactShareRequestSchema, req);
    const target = await sharing(req, res);
    if (!target) return;
    try {
      const created = await createShare(target.deps, target.stored, choice);
      res.set('Cache-Control', 'no-store').status(201).json(created);
    } catch (error) {
      failed(res, error);
    }
  });

  router.delete('/artifacts/:id/versions/:version/share', async (req, res) => {
    const target = await sharing(req, res);
    if (!target) return;
    try {
      await stopShare(target.deps, target.stored);
      res.status(204).end();
    } catch (error) {
      failed(res, error);
    }
  });

  return router;
}
