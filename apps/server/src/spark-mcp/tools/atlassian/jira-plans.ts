import { z } from 'zod';
import {
  ATLASSIAN_CARD_TEXT_MAX,
  type JiraCardRow,
  type JiraEditAction,
  type JiraEditOp,
} from '@spark-outpost/contracts';

const fieldMap = z.record(z.string(), z.unknown());
const visibility = z.object({ type: z.enum(['role', 'group']), value: z.string() }).nullable();
const worklogInput = z.object({
  timeSpent: z.string().optional(),
  started: z.string().optional(),
  comment: z.string().optional(),
});

export const JIRA_PLANS = {
  update: z.object({ fields: fieldMap, update: fieldMap }),
  transition: z.object({ id: z.string(), fields: fieldMap, comment: z.string().nullable() }),
  comment: z.object({ body: z.string(), visibility }),
  edit_comment: z.object({ visibility }),
  link: z.object({ type: z.string(), inward: z.string(), outward: z.string() }),
  unlink: z.object({ id: z.string() }),
  watch: z.object({ accountId: z.string() }),
  unwatch: z.object({ accountId: z.string() }),
  log_work: worklogInput,
  edit_worklog: z.object({ id: z.string(), updated: z.string().nullable(), input: worklogInput }),
  delete_worklog: z.object({ id: z.string(), updated: z.string().nullable() }),
  attach: z.object({
    path: z.string(),
    name: z.string(),
    size: z.number(),
    sha256: z.string(),
    mimeType: z.string(),
  }),
  delete_attachment: z.object({ id: z.string() }),
  sprint: z.object({ sprintId: z.number(), keys: z.array(z.string()) }),
  backlog: z.object({ keys: z.array(z.string()) }),
  rank: z.object({ other: z.string(), after: z.boolean() }),
  create_sprint: z.object({
    boardId: z.number(),
    name: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    goal: z.string().optional(),
  }),
  start_sprint: z.object({ sprintId: z.number(), startDate: z.string(), endDate: z.string() }),
  complete_sprint: z.object({ sprintId: z.number() }),
  create_version: z.object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    releaseDate: z.string().optional(),
  }),
  release_version: z.object({ id: z.string(), releaseDate: z.string() }),
  clone: z.object({ fields: fieldMap }),
} satisfies Partial<Record<JiraEditOp, z.ZodType>>;

export type JiraPlans = typeof JIRA_PLANS;
export type PlanOf<Op extends keyof JiraPlans> = z.infer<JiraPlans[Op]>;

export function planOf<Op extends keyof JiraPlans>(action: JiraEditAction, op: Op): PlanOf<Op> {
  return JIRA_PLANS[op].parse(action.plan) as PlanOf<Op>;
}

export const cardText = (text: string) => text.slice(0, ATLASSIAN_CARD_TEXT_MAX);

export function row(
  label: string,
  before: string | null,
  after: string | null,
  key: string | null = null,
): JiraCardRow {
  return {
    key,
    label,
    before: before === null ? null : cardText(before),
    after: after === null ? null : cardText(after),
  };
}

export function baseAction(
  op: JiraEditOp,
  ticket: JiraEditAction['ticket'],
  updated: string | null,
): JiraEditAction {
  return {
    action: 'jira_edit',
    op,
    ticket,
    updated,
    changes: {},
    before: null,
    after: null,
    comment: null,
    subtasks: [],
    rows: [],
    targets: [],
    plan: null,
  };
}

export function jiraTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toISOString().replace('Z', '+0000');
}
