import { Router } from 'express';
import {
  addTaskLinkRequestSchema,
  artifactKindSchema,
  artifactMarkdown,
  changedFileQuerySchema,
  PIECE_KEY_PATTERN,
  pieceNoteRequestSchema,
  providerIdSchema,
  steerRequestSchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { advisorUsageForRuns } from '../persistence/advice.ts';
import { planVersions } from '../persistence/artifacts.ts';
import { currentPieceList } from '../persistence/pieces.ts';
import { applySteer, SteerError } from '../coordinator/steer.ts';
import { classifySteer } from '../coordinator/steer-rules.ts';
import { addTaskLink, TaskNotFoundError } from '../persistence/tasks.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { taskCoreImpact } from '../map/impact.ts';
import { taskChangedFile, taskChanges } from '../projects/task-changes.ts';
import { agreedPlans } from '../plans/agreed-plans.ts';
import { findPullRequests } from '../tasks/pr-links.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface TaskRouteDeps {
  db: Db;
  workspaceId: string;
}

const MARKDOWN_FILE = /^([a-z]+)\.md$/;

export function taskRoutes({ db, workspaceId }: TaskRouteDeps): Router {
  const router = Router();

  router.get('/tasks/:id', async (req, res) => {
    const task = await getTaskDetail(db, paramId(req));
    if (!task) throw new TaskNotFoundError(paramId(req));
    res.json({
      ...task,
      agreedPlans: await agreedPlans(db, task.conversationId),
      advisors: await advisorUsageForRuns(db, task.runIds),
    });
  });

  router.get('/tasks/:id/pieces', async (req, res) => {
    const list = await currentPieceList(db, paramId(req));
    if (!list) {
      res.status(404).json({ error: 'This task has no piece list.' });
      return;
    }
    res.json(list);
  });

  router.post('/tasks/:id/steer', async (req, res) => {
    const taskId = paramId(req);
    const request = parseBody(steerRequestSchema, req);
    const list = await currentPieceList(db, taskId);
    if (!list) throw new SteerError(404, 'This task has no pieces to steer.');
    const classified = classifySteer(request.text, request.target, list.pieces);
    if (!classified.ok) throw new SteerError(400, classified.error);
    res.status(202).json(await applySteer(db, taskId, classified.plan));
  });

  router.post('/tasks/:id/pieces/:key/notes', async (req, res) => {
    const taskId = paramId(req);
    const key = String(req.params.key);
    if (!PIECE_KEY_PATTERN.test(key)) throw new BadRequestError('Use a piece key such as P2.');
    const note = parseBody(pieceNoteRequestSchema, req);
    const provider = note.kind === 'reassign' ? providerIdSchema.safeParse(note.body) : null;
    if (provider && !provider.success)
      throw new BadRequestError('Name a provider: claude, codex or zai.');
    const plan = {
      kind: note.kind,
      target: key,
      body: note.body,
      provider: provider?.data ?? null,
    };
    res.status(202).json(await applySteer(db, taskId, plan, note.urgent));
  });

  router.get('/tasks/:id/changes', async (req, res) => {
    const taskId = paramId(req);
    const changes = await taskChanges(db, workspaceId, taskId);
    res.json({ ...changes, core: await taskCoreImpact(db, taskId, changes) });
  });

  router.get('/tasks/:id/changes/file', async (req, res) => {
    const query = changedFileQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError('Pass a runId and a path.');
    const file = await taskChangedFile(db, workspaceId, paramId(req), query.data);
    if (!file) {
      res.status(404).json({ error: 'That file has no changes in this task.' });
      return;
    }
    res.json(file);
  });

  router.post('/tasks/:id/links', async (req, res) => {
    const request = parseBody(addTaskLinkRequestSchema, req);
    const pullRequest = findPullRequests(request.url)[0];
    const { link, created } = await addTaskLink(db, paramId(req), {
      kind: pullRequest ? 'pr' : 'link',
      url: request.url,
      title: request.title || pullRequest?.title || null,
      source: 'user',
    });
    res.status(created ? 201 : 200).json(link);
  });

  router.get('/tasks/:id/artifacts/:file', async (req, res) => {
    const taskId = paramId(req);
    const kind = artifactKindSchema.safeParse(MARKDOWN_FILE.exec(req.params.file)?.[1]);
    if (!kind.success) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
    const task = await getTaskDetail(db, taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    const versions = kind.data === 'plan' ? await planVersions(db, taskId) : [];
    res
      .type('text/markdown; charset=utf-8')
      .attachment(`${kind.data}.md`)
      .send(artifactMarkdown(kind.data, versions));
  });

  return router;
}
