import { COMMAND_TASKS } from './commands.ts';
import { SAFETY_TASKS } from './probes.ts';
import { QUALITY_TASKS } from './quality.ts';
import { SPARK_TOOL_TASKS } from './spark-tool.ts';
import type { Task, TaskSet } from './types.ts';

export const TASKS: readonly Task[] = [
  ...QUALITY_TASKS,
  ...COMMAND_TASKS,
  ...SPARK_TOOL_TASKS,
  ...SAFETY_TASKS,
];

export function taskById(id: string): Task {
  const task = TASKS.find((candidate) => candidate.id === id);
  if (!task)
    throw new Error(`Unknown task ${id}. Known: ${TASKS.map((item) => item.id).join(', ')}.`);
  return task;
}

export function tasksNamed(choice: string): Task[] {
  if (choice === 'all') return [...TASKS];
  return choice.split(',').flatMap((part) => {
    const id = part.trim();
    const group = TASKS.filter((task) => String(task.number) === id);
    return group.length > 1 ? group : [taskById(id)];
  });
}

export function tasksIn(set: TaskSet): Task[] {
  return TASKS.filter((task) => task.set === set);
}
