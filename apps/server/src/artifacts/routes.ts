import { Router, type Request } from 'express';
import {
  ARTIFACT_FILE_EXTENSIONS,
  artifactOrigin,
  type ArtifactView,
} from '@spark-outpost/contracts';
import { contentDisposition } from '../api/content-disposition.ts';
import { paramId } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { readVersionFile } from './files.ts';
import { sendArtifactPage } from './page-headers.ts';
import { artifactWorkspace, findVersion, type StoredVersion } from './store.ts';

export interface ArtifactRouteDeps {
  db: Db;
  workspaceId: string;
  port: number;
  chatFolders?: string;
  artifactOriginDown?: boolean;
}

function versionParam(req: Request): number | null {
  const version = Number(req.params.version);
  return Number.isInteger(version) && version > 0 ? version : null;
}

const FILE_TYPES = {
  html: 'text/html',
  markdown: 'text/markdown',
  svg: 'image/svg+xml',
} as const;

function fileName(stored: StoredVersion): string {
  const base = stored.title.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'artifact';
  return `${base}.${ARTIFACT_FILE_EXTENSIONS[stored.kind]}`;
}

export function artifactRoutes({
  db,
  workspaceId,
  port,
  chatFolders,
  artifactOriginDown,
}: ArtifactRouteDeps): Router {
  const router = Router();

  const load = async (req: Request) => {
    const id = paramId(req);
    const version = versionParam(req);
    if (!chatFolders || version === null) return null;
    if ((await artifactWorkspace(db, id)) !== workspaceId) return null;
    const stored = await findVersion(db, id, version);
    if (!stored?.published) return null;
    const text = await readVersionFile(chatFolders, stored);
    return text === null ? null : { stored, text };
  };

  router.get('/artifacts/:id/versions/:version/view', async (req, res) => {
    const found = await load(req);
    if (!found) {
      res.status(404).json({ error: 'Artifact not found.' });
      return;
    }
    const { stored, text } = found;
    const html = stored.kind === 'html';
    const view: ArtifactView = {
      id: stored.artifactId,
      version: stored.version,
      title: stored.title,
      kind: stored.kind,
      viewUrl: html && !artifactOriginDown ? `${artifactOrigin(port)}/v/${stored.viewKey}` : null,
      text,
    };
    res.set('Cache-Control', 'no-store').json(view);
  });

  router.get('/artifacts/:id/versions/:version/page', async (req, res) => {
    const found = await load(req);
    if (!found || found.stored.kind !== 'html') {
      res.status(404).json({ error: 'Artifact not found.' });
      return;
    }
    sendArtifactPage(res, found.text, ["'self'"]);
  });

  router.get('/artifacts/:id/versions/:version/file', async (req, res) => {
    const found = await load(req);
    if (!found) {
      res.status(404).json({ error: 'Artifact not found.' });
      return;
    }
    const body = Buffer.from(found.text, 'utf8');
    res.set({
      'Content-Type': FILE_TYPES[found.stored.kind],
      'Content-Length': String(body.length),
      'Content-Disposition': contentDisposition('attachment', fileName(found.stored)),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });

  return router;
}
