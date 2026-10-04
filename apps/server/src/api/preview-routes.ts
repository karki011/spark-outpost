import { Router } from 'express';
import {
  previewTerminalRequestSchema,
  savePreviewRequestSchema,
  type ChatPreview,
  type CreateShellResponse,
  type ProjectPreview,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { askPreviewStop, previewRowAt, previewRowLive } from '../persistence/preview-servers.ts';
import {
  chatPreview,
  chatPreviewPlace,
  PreviewNotSetUpError,
  startPreview,
} from '../preview/requests.ts';
import type { PreviewServers } from '../preview/servers.ts';
import { readPreviewSuggestions } from '../preview/suggest.ts';
import { getProject, saveProjectPreview } from '../projects/projects.ts';
import type { TerminalSessions } from '../terminal/sessions.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface PreviewRouteDeps {
  db: Db;
  workspaceId: string;
  terminals: TerminalSessions;
  previews: PreviewServers;
}

const BY_USER = { by: 'user', runId: null } as const;

export function previewRoutes({ db, workspaceId, terminals, previews }: PreviewRouteDeps): Router {
  const router = Router();

  const placeOf = async (conversationId: string) => {
    const place = await chatPreviewPlace(db, workspaceId, conversationId);
    if (!place) throw new BadRequestError('Link a project to this chat to use its preview.');
    return place;
  };

  router.get('/projects/:id/preview', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    const response: ProjectPreview = {
      preview: project.preview ?? null,
      suggestions: await readPreviewSuggestions(project.rootPath),
    };
    res.json(response);
  });

  router.put('/projects/:id/preview', async (req, res) => {
    const { preview } = parseBody(savePreviewRequestSchema, req);
    const id = paramId(req);
    const saved = await saveProjectPreview(db, workspaceId, id, preview);
    await previews.stopProject(id, 'setting_changed');
    res.json(saved);
  });

  router.get('/conversations/:id/preview', async (req, res) => {
    const response: ChatPreview = await chatPreview(db, workspaceId, paramId(req));
    res.json(response);
  });

  router.post('/conversations/:id/preview/start', async (req, res) => {
    const conversationId = paramId(req);
    const place = await placeOf(conversationId);
    try {
      await startPreview(db, place, { ...BY_USER, conversationId });
    } catch (error) {
      if (error instanceof PreviewNotSetUpError) {
        throw new BadRequestError('Set up the preview in Settings, Projects first.');
      }
      throw error;
    }
    await previews.sync();
    res.json(await chatPreview(db, workspaceId, conversationId));
  });

  router.post('/conversations/:id/preview/stop', async (req, res) => {
    const conversationId = paramId(req);
    const place = await placeOf(conversationId);
    const row = await previewRowAt(db, place.projectId, place.folder);
    if (row) await askPreviewStop(db, row.id, { ...BY_USER, conversationId }, 'user');
    await previews.sync();
    res.json(await chatPreview(db, workspaceId, conversationId));
  });

  router.post('/terminal/previews', async (req, res) => {
    const { conversationId } = parseBody(previewTerminalRequestSchema, req);
    const place = await placeOf(conversationId);
    const row = await previewRowAt(db, place.projectId, place.folder);
    if (!row || !previewRowLive(row)) {
      throw new BadRequestError('The preview is not running. Start it from the Browser pane.');
    }
    const created = terminals.createView((viewer, size) => previews.view(row.id, viewer, size));
    const response: CreateShellResponse = {
      ...created,
      cwd: row.folder,
      label: 'Preview',
      kind: place.folder === place.rootPath ? 'project' : 'worktree',
      note: null,
    };
    res.status(201).json(response);
  });

  return router;
}
