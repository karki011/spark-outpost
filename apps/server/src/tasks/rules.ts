export interface TaskRef {
  id: string;
  status: 'open' | 'closed';
}

export type TaskChoice = { kind: 'join'; taskId: string } | { kind: 'open' } | { kind: 'none' };

export function chooseTask(latest: TaskRef | null, didWork: boolean): TaskChoice {
  if (latest?.status === 'open') return { kind: 'join', taskId: latest.id };
  return didWork ? { kind: 'open' } : { kind: 'none' };
}
