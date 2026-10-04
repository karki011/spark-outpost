import { Router } from 'express';
import {
  changeDiffQuerySchema,
  changePageQuerySchema,
  type ChangeSummary,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { taskCoreImpact } from '../map/impact.ts';
import { changeDiff, canShowText } from '../projects/change-diff.ts';
import {
  ChangeSetCache,
  changePage,
  findEntry,
  summarize,
  toEntry,
} from '../projects/change-sets.ts';
import { RunListingCache } from '../projects/run-listing-cache.ts';
import { leanChanges, taskChangeSet } from '../projects/task-changes.ts';
import { BadRequestError, paramId } from './validation.ts';

export interface TaskChangeRouteDeps {
  db: Db;
  workspaceId: string;
}

function runList(runs: string | undefined): string[] | undefined {
  return runs ? runs.split(',').filter(Boolean) : undefined;
}

export function taskChangeRoutes({ db, workspaceId }: TaskChangeRouteDeps): Router {
  const router = Router();
  const listings = new RunListingCache();
  const sets = new ChangeSetCache((taskId) => taskChangeSet(db, workspaceId, taskId, listings));

  router.get('/tasks/:id/changes', async (req, res) => {
    const taskId = paramId(req);
    const changes = leanChanges((await sets.fresh(taskId)).runs);
    res.json({ ...changes, core: await taskCoreImpact(db, taskId, changes) });
  });

  router.get('/tasks/:id/changes/summary', async (req, res) => {
    const taskId = paramId(req);
    const set = await sets.fresh(taskId);
    const summary: ChangeSummary = {
      ...summarize(set),
      core: await taskCoreImpact(db, taskId, leanChanges(set.runs)),
    };
    res.json(summary);
  });

  router.get('/tasks/:id/changes/files', async (req, res) => {
    const query = changePageQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError('Pass a valid offset, limit and filter.');
    const { version, runs, ...page } = query.data;
    const set = await sets.get(paramId(req), version);
    res.json(changePage(set, { ...page, runs: runList(runs) }));
  });

  router.get('/tasks/:id/changes/diff', async (req, res) => {
    const query = changeDiffQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError('Pass a runId and a path.');
    const { runId, path, version, lines } = query.data;
    const set = await sets.get(paramId(req), version);
    const found = findEntry(set, runId, path);
    if (!found) {
      res.status(404).json({ error: 'That file has no changes in this task.' });
      return;
    }
    const entry = toEntry(found);
    const contents = canShowText(entry) ? await sets.fileContents(set, found) : null;
    res.json(changeDiff(entry, contents, lines));
  });

  return router;
}
