import { z } from 'zod';
import type { TicketRelated, TicketRelation, TicketStatus } from '@spark-outpost/contracts';
import { lenient, lenientList, MAX_CHILDREN } from './ticket-relations.ts';

const statusShape = z.object({
  name: z.string(),
  statusCategory: z.object({ key: z.string() }).optional(),
});
type JiraStatus = z.infer<typeof statusShape>;

const issueRef = z.object({
  key: z.string(),
  fields: z.object({ summary: z.string(), status: statusShape }),
});
const linkEntry = z.object({
  type: z.object({ inward: z.string(), outward: z.string() }),
  inwardIssue: lenient(issueRef).optional(),
  outwardIssue: lenient(issueRef).optional(),
});

export const jiraRelationFields = {
  parent: lenient(issueRef).optional(),
  issuelinks: lenientList(linkEntry).optional(),
  subtasks: lenientList(issueRef).optional(),
};

export interface JiraRelationFields {
  parent?: z.infer<typeof issueRef> | null | undefined;
  issuelinks?: z.infer<typeof linkEntry>[] | undefined;
  subtasks?: z.infer<typeof issueRef>[] | undefined;
}

interface Context {
  siteUrl: string;
  bucket: (status: JiraStatus) => TicketStatus;
}

export interface JiraRelations {
  parent: TicketRelated | null;
  subtasks: TicketRelated[];
  subtasksMore: boolean;
  relations: TicketRelation[];
}

export function readJiraRelations(fields: JiraRelationFields, context: Context): JiraRelations {
  const related = (issue: z.infer<typeof issueRef>): TicketRelated => ({
    key: issue.key,
    title: issue.fields.summary,
    status: context.bucket(issue.fields.status),
    statusName: issue.fields.status.name,
    url: `${context.siteUrl}/browse/${encodeURIComponent(issue.key)}`,
  });
  const subtasks = fields.subtasks ?? [];
  const relations = (fields.issuelinks ?? []).flatMap((link): TicketRelation[] => [
    ...(link.outwardIssue ? [{ ...related(link.outwardIssue), relation: link.type.outward }] : []),
    ...(link.inwardIssue ? [{ ...related(link.inwardIssue), relation: link.type.inward }] : []),
  ]);
  return {
    parent: fields.parent ? related(fields.parent) : null,
    subtasks: subtasks.slice(0, MAX_CHILDREN).map(related),
    subtasksMore: subtasks.length > MAX_CHILDREN,
    relations,
  };
}
