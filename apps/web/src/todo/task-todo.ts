import type { TaskOverview } from '@spark-outpost/contracts';

export function hasTodo(task: Pick<TaskOverview, 'todo'>): boolean {
  return task.todo.length > 0;
}

export function todoPercent(task: Pick<TaskOverview, 'summary'>): number {
  const { done, total } = task.summary;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
