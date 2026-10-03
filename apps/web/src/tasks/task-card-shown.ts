import type { TaskOverview } from '@spark-outpost/contracts';

function isReply(id: string): boolean {
  return id === 'understood' || id.startsWith('run:');
}

export function showsTaskCard(task: TaskOverview): boolean {
  if (task.summary.waiting > 0) return true;
  return task.items.some((item) => !isReply(item.id));
}
