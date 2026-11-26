import { Router, type Response } from 'express';
import {
  LOCAL_SPARK_ID,
  renameLocalSparkRequestSchema,
  sparkIconPath,
  type LocalSpark,
  type RemoteSpark,
} from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { ICON_REFUSED, sparkIconFrom } from './icon.ts';
import {
  localSparkIcon,
  remoteSparkIcon,
  renameLocalSpark,
  setLocalSparkIcon,
  setRemoteSparkIcon,
  type LocalSparkRow,
  type RemoteSparkRow,
} from './store.ts';

interface SparkIconRouteDeps {
  db: Db;
  workspaceId: string;
  defaultName: string;
  noSpark: string;
  toSpark(row: RemoteSparkRow): Promise<RemoteSpark>;
}

const NO_ICON = 'That Spark has no icon.';

export function iconPathOf(id: string, version: string | null): string | null {
  return version === null ? null : sparkIconPath(id, version);
}

export function toLocalSpark(row: LocalSparkRow, defaultName: string): LocalSpark {
  return {
    name: row.name,
    defaultName,
    icon: iconPathOf(LOCAL_SPARK_ID, row.icon_version),
  };
}

function sendIcon(res: Response, icon: Buffer | null): void {
  if (!icon) {
    res.status(404).json({ error: NO_ICON });
    return;
  }
  res
    .status(200)
    .set({
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    .end(icon);
}

export function sparkIconRoutes(deps: SparkIconRouteDeps): Router {
  const { db, workspaceId, defaultName, noSpark, toSpark } = deps;
  const router = Router();

  const sendSpark = async (res: Response, row: RemoteSparkRow | null): Promise<void> => {
    if (!row) {
      res.status(404).json({ error: noSpark });
      return;
    }
    res.json(await toSpark(row));
  };

  router.put('/remote-sparks/local', async (req, res) => {
    const { name } = parseBody(renameLocalSparkRequestSchema, req);
    res.json(toLocalSpark(await renameLocalSpark(db, workspaceId, name), defaultName));
  });

  router.get('/remote-sparks/local/icon', async (_req, res) => {
    sendIcon(res, await localSparkIcon(db, workspaceId));
  });

  router.put('/remote-sparks/local/icon', async (req, res) => {
    const icon = sparkIconFrom(req.body);
    if (!icon) {
      res.status(400).json({ error: ICON_REFUSED });
      return;
    }
    res.json(toLocalSpark(await setLocalSparkIcon(db, workspaceId, icon), defaultName));
  });

  router.delete('/remote-sparks/local/icon', async (_req, res) => {
    res.json(toLocalSpark(await setLocalSparkIcon(db, workspaceId, null), defaultName));
  });

  router.get('/remote-sparks/:id/icon', async (req, res) => {
    sendIcon(res, await remoteSparkIcon(db, workspaceId, paramId(req)));
  });

  router.put('/remote-sparks/:id/icon', async (req, res) => {
    const id = paramId(req);
    const icon = sparkIconFrom(req.body);
    if (!icon) {
      res.status(400).json({ error: ICON_REFUSED });
      return;
    }
    await sendSpark(res, await setRemoteSparkIcon(db, workspaceId, id, icon));
  });

  router.delete('/remote-sparks/:id/icon', async (req, res) => {
    await sendSpark(res, await setRemoteSparkIcon(db, workspaceId, paramId(req), null));
  });

  return router;
}
