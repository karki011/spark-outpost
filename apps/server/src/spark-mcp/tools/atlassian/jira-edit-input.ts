import { z } from 'zod';
import { ATLASSIAN_BODY_MAX, jiraEditOpSchema, ticketKeySchemaFor } from '@spark-outpost/contracts';
import { SparkToolError } from '../../tool.ts';

const key = ticketKeySchemaFor('jira');
const short = (max: number) => z.string().trim().min(1).max(max).optional();
const labels = z.array(z.string().trim().min(1).max(100)).max(50).optional();

export const jiraEditInput = {
  action: jiraEditOpSchema,
  key: key.optional(),
  keys: z.array(key).max(20).optional(),
  summary: short(255),
  description: z.string().max(ATLASSIAN_BODY_MAX).optional(),
  labels,
  addLabels: labels,
  removeLabels: labels,
  priority: short(100),
  parent: z
    .string()
    .trim()
    .regex(/^(none|[A-Za-z][A-Za-z0-9_]*-\d+)$/i)
    .optional(),
  issueType: short(100),
  team: short(100),
  assignee: short(200),
  reporter: short(200),
  originalEstimate: short(40),
  remainingEstimate: short(40),
  fields: z.record(z.string().max(100), z.unknown()).optional(),
  id: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  body: z.string().trim().min(1).max(ATLASSIAN_BODY_MAX).optional(),
  visibility: z
    .object({ type: z.enum(['role', 'group']), value: z.string().trim().min(1).max(200) })
    .optional(),
  to: short(100),
  resolution: short(100),
  linkType: short(100),
  otherKey: key.optional(),
  user: short(200),
  timeSpent: short(40),
  start: short(40),
  end: short(40),
  name: short(255),
  path: short(1_000),
  project: short(100),
  withSubtasks: z.boolean().default(false),
};

export type JiraEditArgs = z.output<z.ZodObject<typeof jiraEditInput>>;

export function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null || value === '') {
    throw new SparkToolError(`Pass ${what}.`);
  }
  return value;
}
