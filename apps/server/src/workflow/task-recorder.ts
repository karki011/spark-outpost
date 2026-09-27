import type { PlanEntry, RunEvent } from '@spark-outpost/contracts';
import { latestPlan } from '../persistence/artifacts.ts';
import type { Db } from '../persistence/db.ts';
import type { AppendOptions } from '../persistence/run-events.ts';
import { addTaskLink, runTask, taskForWorkingRun, type RunTask } from '../persistence/tasks.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { nextPlanWrite, type StoredPlan } from '../tasks/plan-versions.ts';
import { findPullRequests } from '../tasks/pr-links.ts';
import { runEvents } from './run-events.ts';

type Append = (event: RunEvent, options?: AppendOptions) => Promise<number>;
type LinkOutput = Omit<Extract<ProviderOutput, { kind: 'link' }>, 'kind'>;

export interface TaskRecorder {
  observe(output: ProviderOutput): Promise<void>;
  replied(text: string): Promise<void>;
}

export function createTaskRecorder(
  db: Db,
  runId: string,
  request: string,
  append: Append,
  recordsPlan = true,
): TaskRecorder {
  let task: RunTask | null | undefined;
  let latest: StoredPlan | null | undefined;

  const current = async (): Promise<RunTask | null> => {
    if (task === undefined) task = await runTask(db, runId);
    return task;
  };

  const ensure = async (): Promise<RunTask> => {
    const existing = await current();
    if (existing) return existing;
    const joined = await taskForWorkingRun(db, runId, request);
    task = joined.task;
    await append(
      runEvents.activity('task', 'task', { taskId: task.taskId, opened: joined.opened }),
    );
    return task;
  };

  const recordPlan = async (entries: PlanEntry[]) => {
    if (!recordsPlan || (entries.length === 0 && !(await current()))) return;
    const { taskId } = await ensure();
    latest ??= await latestPlan(db, taskId);
    const write = nextPlanWrite(latest, entries, runId);
    if (!write) return;
    const body = { entries };
    await append(runEvents.activity('artifact:plan', 'plan', { version: write.version, body }), {
      artifact: { taskId, kind: 'plan', body, ...write },
    });
    latest = { version: write.version, entries, sourceRunId: runId };
  };

  const recordLink = async (link: LinkOutput) => {
    const owner = await current();
    if (!owner) return;
    const saved = await addTaskLink(db, owner.taskId, { kind: 'pr', ...link });
    if (!saved.created) return;
    await append(
      runEvents.activity(`link:${saved.link.id}`, 'link', {
        url: saved.link.url,
        kind: saved.link.kind,
        title: saved.link.title,
        source: saved.link.source,
      }),
    );
  };

  return {
    async observe(output) {
      if (output.kind === 'step_started' && output.tool) await ensure();
      if (output.kind === 'plan') await recordPlan(output.entries);
      if (output.kind === 'link') {
        await recordLink({ url: output.url, title: output.title, source: output.source });
      }
    },
    async replied(text) {
      for (const pr of findPullRequests(text)) await recordLink({ ...pr, source: 'agent_text' });
    },
  };
}
