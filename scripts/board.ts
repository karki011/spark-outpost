import { z } from 'zod';

export const statuses = ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'] as const;
export type TaskStatus = (typeof statuses)[number];

const statusTitles: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};

const noteSchema = z.object({ date: z.string(), status: z.enum(statuses), text: z.string() });

const taskSchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d+$/),
  title: z.string().min(1),
  phase: z.string(),
  status: z.enum(statuses),
  acceptance: z.array(z.string()),
  notes: z.array(noteSchema),
});

export const boardSchema = z.object({ tasks: z.array(taskSchema) });
export type Board = z.infer<typeof boardSchema>;
export type Task = z.infer<typeof taskSchema>;

export function isTaskStatus(value: string): value is TaskStatus {
  return (statuses as readonly string[]).includes(value);
}

export function moveTask(
  board: Board,
  id: string,
  status: TaskStatus,
  note: string,
  date: string,
): Board {
  const task = board.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Task ${id} does not exist.`);
  if (status === 'done' && note.trim().length === 0) {
    throw new Error('Marking a task done requires a note with acceptance evidence.');
  }
  return {
    tasks: board.tasks.map((candidate) =>
      candidate.id === id
        ? {
            ...candidate,
            status,
            notes: note ? [...candidate.notes, { date, status, text: note }] : candidate.notes,
          }
        : candidate,
    ),
  };
}

export function renderKanban(board: Board): string {
  const sections = statuses.map((status) => {
    const tasks = board.tasks.filter((task) => task.status === status);
    const rows = tasks.map((task) => {
      const latest = task.notes.at(-1);
      const note = latest ? ` — ${latest.date}: ${latest.text}` : '';
      return `- **${task.id}** ${task.title} _(phase ${task.phase})_${note}`;
    });
    return [
      `## ${statusTitles[status]} (${tasks.length})`,
      '',
      ...(rows.length ? rows : ['_None_']),
    ].join('\n');
  });
  return [
    '# Kanban',
    '',
    'Generated from `docs/tasks/board.json` by `pnpm tasks`. Do not edit by hand.',
    '',
    ...sections.flatMap((section) => [section, '']),
  ].join('\n');
}
