import { Router } from 'express';
import {
  addTaskLinkRequestSchema,
  artifactKindSchema,
  artifactMarkdown,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { advisorUsageForRuns } from '../persistence/advice.ts';
import { planVersions } from '../persistence/artifacts.ts';
import { currentPieceList } from '../persistence/pieces.ts';
import { addTaskLink, TaskNotFoundError } from '../persistence/tasks.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { agreedPlans } from '../plans/agreed-plans.ts';
import { findPullRequests } from '../tasks/pr-links.ts';
import { paramId, parseBody } from './validation.ts';

export interface TaskRouteDeps {
  db: Db;
}

const MARKDOWN_FILE = /^([a-z]+)\.md$/;

export function taskRoutes({ db }: TaskRouteDeps): Router {
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
