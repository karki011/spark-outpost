import { closeKeyedSessions } from '../persistence/provider-sessions.ts';
import { startNewTask, taskForWorkingRun } from '../persistence/tasks.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { CurrentTask } from './intake.ts';
import { builderKey, type Session } from './session.ts';

export const TASK_SESSION_CLOSED = 'task session closed';
const NEW_TASK_STARTED = 'a new task started';

export async function ensureTask(s: Session, current: CurrentTask | null): Promise<void> {
  if (s.taskId) return;
  if (current && !s.continuesTask) {
    const started = await startNewTask(s.deps.db, s.lease.runId, s.input.userRequest);
    s.taskId = started.taskId;
    if (started.closed) await closeTaskSessions(s, started.closed, NEW_TASK_STARTED);
    await s.append(runEvents.activity('task', 'task', { taskId: s.taskId, opened: true }));
    return;
  }
  const joined = await taskForWorkingRun(s.deps.db, s.lease.runId, s.input.userRequest);
  s.taskId = joined.task.taskId;
  await s.append(runEvents.activity('task', 'task', { taskId: s.taskId, opened: joined.opened }));
}

export async function closeTaskSessions(s: Session, taskId: string, reason: string): Promise<void> {
  await closeKeyedSessions(
    s.deps.db,
    s.input.identity.threadId,
    `key:${builderKey(taskId)}`,
    reason,
  ).catch(() => undefined);
}
