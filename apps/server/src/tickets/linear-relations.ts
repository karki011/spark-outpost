import { z } from 'zod';
import type { TicketRelated, TicketRelation, TicketStatus } from '@spark-outpost/contracts';
import { lenient, lenientList, MAX_CHILDREN } from './ticket-relations.ts';

const issueRef = z.object({
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  state: z.object({ name: z.string(), type: z.string() }),
});
type LinearRef = z.infer<typeof issueRef>;

const REF_FIELDS = 'identifier title url state { name type }';
export const LINEAR_RELATIONS_SELECTION = `
  parent { ${REF_FIELDS} }
  children(first: ${MAX_CHILDREN}) { pageInfo { hasNextPage } nodes { ${REF_FIELDS} } }
  relations(first: ${MAX_CHILDREN}) { nodes { type relatedIssue { ${REF_FIELDS} } } }
  inverseRelations(first: ${MAX_CHILDREN}) { nodes { type issue { ${REF_FIELDS} } } }`;

const outwardEdge = z
  .object({
    nodes: lenientList(z.object({ type: z.string(), relatedIssue: lenient(issueRef) })),
  })
  .nullable()
  .optional()
  .catch(null);
const inwardEdge = z
  .object({ nodes: lenientList(z.object({ type: z.string(), issue: lenient(issueRef) })) })
  .nullable()
  .optional()
  .catch(null);

export const linearRelationFields = {
  parent: lenient(issueRef).optional(),
  children: z
    .object({
      nodes: lenientList(issueRef),
      pageInfo: z.object({ hasNextPage: z.boolean() }).nullable().optional().catch(null),
    })
    .nullable()
    .optional()
    .catch(null),
  relations: outwardEdge,
  inverseRelations: inwardEdge,
};

export interface LinearRelationFields {
  parent?: LinearRef | null | undefined;
  children?:
    | {
        nodes: LinearRef[];
        pageInfo?: { hasNextPage: boolean } | null | undefined;
      }
    | null
    | undefined;
  relations?: { nodes: { type: string; relatedIssue: LinearRef | null }[] } | null | undefined;
  inverseRelations?: { nodes: { type: string; issue: LinearRef | null }[] } | null | undefined;
}

const OUTWARD: Record<string, string> = {
  blocks: 'blocks',
  duplicate: 'duplicates',
  related: 'relates to',
  similar: 'is similar to',
};
const INWARD: Record<string, string> = {
  blocks: 'is blocked by',
  duplicate: 'is duplicated by',
  related: 'relates to',
  similar: 'is similar to',
};

export interface LinearRelations {
  parent: TicketRelated | null;
  subtasks: TicketRelated[];
  subtasksMore: boolean;
  relations: TicketRelation[];
}

export function readLinearRelations(
  fields: LinearRelationFields,
  bucket: (state: { name: string; type: string }) => TicketStatus,
): LinearRelations {
  const related = (issue: LinearRef): TicketRelated => ({
    key: issue.identifier,
    title: issue.title,
    status: bucket(issue.state),
    statusName: issue.state.name,
    url: issue.url,
  });
  const children = fields.children?.nodes ?? [];
  const outward = (fields.relations?.nodes ?? []).flatMap((node) =>
    node.relatedIssue
      ? [{ ...related(node.relatedIssue), relation: OUTWARD[node.type] ?? 'relates to' }]
      : [],
  );
  const inward = (fields.inverseRelations?.nodes ?? []).flatMap((node) =>
    node.issue ? [{ ...related(node.issue), relation: INWARD[node.type] ?? 'relates to' }] : [],
  );
  return {
    parent: fields.parent ? related(fields.parent) : null,
    subtasks: children.slice(0, MAX_CHILDREN).map(related),
    subtasksMore: children.length > MAX_CHILDREN || fields.children?.pageInfo?.hasNextPage === true,
    relations: [...outward, ...inward],
  };
}
