import { Router } from 'express';
import {
  addTaskLinkRequestSchema,
  artifactKindSchema,
  artifactMarkdown,
  changedFileQuerySchema,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { advisorUsageForRuns } from '../persistence/advice.ts';
import { planVersions } from '../persistence/artifacts.ts';
import { addTaskLink, TaskNotFoundError } from '../persistence/tasks.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
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

  router.get('/tasks/:id/changes', async (req, res) => {
    res.json(await taskChanges(db, workspaceId, paramId(req)));
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
