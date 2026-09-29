import { z } from 'zod';
import type { TicketSummary } from '@spark-outpost/contracts';

export const JIRA_EXTRA_FIELDS = ['assignee', 'duedate', 'labels', 'resolutiondate'];

export const jiraExtraFieldsShape = {
  assignee: z
    .object({ accountId: z.string().optional(), displayName: z.string() })
    .nullable()
    .optional(),
  duedate: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  resolutiondate: z.string().nullable().optional(),
};

type JiraExtraFields = z.infer<z.ZodObject<typeof jiraExtraFieldsShape>>;

const PRIORITY_RANKS: [RegExp, number][] = [
  [/highest|blocker|critical|urgent/i, 1],
  [/high|major/i, 2],
  [/medium|normal/i, 3],
  [/low|minor|trivial/i, 4],
];

export function jiraPriorityRank(name: string | null | undefined): number {
  if (!name) return 0;
  return PRIORITY_RANKS.find(([pattern]) => pattern.test(name))?.[1] ?? 0;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function jiraExtras(
  fields: JiraExtraFields & { priority?: { name: string } | null | undefined },
): Pick<TicketSummary, 'priorityRank' | 'assignedTo' | 'labels' | 'dueDate' | 'doneAt'> {
  const assignee = fields.assignee;
  return {
    priorityRank: jiraPriorityRank(fields.priority?.name),
    assignedTo: assignee?.accountId ? { id: assignee.accountId, name: assignee.displayName } : null,
    labels: fields.labels ?? [],
    dueDate: fields.duedate ?? null,
    doneAt: isoOrNull(fields.resolutiondate),
  };
}
