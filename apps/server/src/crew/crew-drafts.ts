import { SPARK_ACTION_KIND, type SparkAction } from '@spark-outpost/contracts';
import { settlePending } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';

export type CrewAction = Extract<
  SparkAction,
  { action: 'create_teammate' | 'update_teammate' | 'delete_teammate' | 'crew_edit' }
>;

export interface PendingCrewCard {
  id: string;
  conversationId: string;
  action: CrewAction;
}

export const DRAFT_REPLACED = 'Replaced by a newer proposal.';
export const DRAFT_WITHDRAWN = 'Withdrawn by the agent.';

export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return a.some((item) => b.includes(item));
}

export function replacesDraft(draft: CrewAction, next: CrewAction): boolean {
  if (draft.action === 'create_teammate' && next.action === 'create_teammate') {
    return nameKey(draft.name) === nameKey(next.name);
  }
  if (draft.action === 'update_teammate' && next.action === 'update_teammate') {
    return draft.teammateId === next.teammateId && overlaps(draft.changed, next.changed);
  }
  if (draft.action === 'delete_teammate' && next.action === 'delete_teammate') {
    return draft.teammateId === next.teammateId;
  }
  if (draft.action !== 'crew_edit' || next.action !== 'crew_edit') return false;
  if (draft.target !== next.target || draft.id !== next.id) return false;
  if (draft.target === 'workflow') return true;
  const paths = (action: typeof draft) => action.files.map((file) => file.path);
  return overlaps(paths(draft), paths(next));
}

export async function pendingCrewCards(
  db: Queryable,
  workspaceId: string,
  conversationId?: string,
): Promise<PendingCrewCard[]> {
  const { rows } = await db.query<{ id: string; conversation_id: string; action: CrewAction }>(
    `SELECT a.id, r.conversation_id, a.payload->'sparkAction' AS action
     FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND c.archived_at IS NULL AND a.status = 'pending'
       AND a.kind = $2
       AND a.payload->'sparkAction'->>'action'
         IN ('create_teammate', 'update_teammate', 'delete_teammate', 'crew_edit')
       AND ($3::uuid IS NULL OR r.conversation_id = $3)
     ORDER BY a.created_at`,
    [workspaceId, SPARK_ACTION_KIND, conversationId ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    action: row.action,
  }));
}

async function closeCards(db: Queryable, ids: readonly string[], note: string): Promise<number> {
  let closed = 0;
  for (const id of ids) {
    const settled = await settlePending(db, id, {
      status: 'cancelled',
      decidedBy: 'policy',
      optionId: null,
      note,
    });
    if (settled) closed += 1;
  }
  return closed;
}

export function replaceDrafts(db: Queryable, ids: readonly string[]): Promise<number> {
  return closeCards(db, ids, DRAFT_REPLACED);
}

export async function withdrawOwnDrafts(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
  ids: readonly string[] | 'all',
): Promise<{ withdrawn: number; notFound: string[] }> {
  const own = await pendingCrewCards(db, workspaceId, conversationId);
  const ownIds = new Set(own.map((card) => card.id));
  const wanted = ids === 'all' ? [...ownIds] : ids;
  const notFound = wanted.filter((id) => !ownIds.has(id));
  const withdrawn = await closeCards(
    db,
    wanted.filter((id) => ownIds.has(id)),
    DRAFT_WITHDRAWN,
  );
  return { withdrawn, notFound };
}

function draftSparkName(action: CrewAction): string | null {
  if (action.action === 'create_teammate') return action.name;
  if (action.action === 'update_teammate' && action.changed.includes('name')) return action.name;
  return null;
}

export interface NameCheck {
  workspaceId: string;
  conversationId: string;
  name: string;
  teammateId?: string | undefined;
}

export async function sparkNameClash(db: Queryable, check: NameCheck): Promise<string | null> {
  const wanted = nameKey(check.name);
  const { rows } = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM teammates WHERE workspace_id = $1',
    [check.workspaceId],
  );
  const saved = rows.find((row) => row.id !== check.teammateId && nameKey(row.name) === wanted);
  if (saved) return `There is already a Spark named ${saved.name}. Pick another name.`;
  const drafts = await pendingCrewCards(db, check.workspaceId);
  const draft = drafts.find((card) => {
    const name = draftSparkName(card.action);
    if (name === null || nameKey(name) !== wanted) return false;
    if (card.action.action === 'update_teammate')
      return card.action.teammateId !== check.teammateId;
    const replaced = card.conversationId === check.conversationId && !check.teammateId;
    return !replaced;
  });
  if (draft) return draftClash('Spark', check.name, draft, check.conversationId);
  return null;
}

function draftClash(
  what: string,
  name: string,
  draft: PendingCrewCard,
  conversationId: string,
): string {
  const where = draft.conversationId === conversationId ? 'this chat' : 'another chat';
  return `A draft ${what} named ${name} is waiting for the user in ${where}. Pick another name.`;
}

export interface WorkflowNameCheck {
  workspaceId: string;
  conversationId: string;
  id: string;
  name: string;
  saved: readonly { id: string; name: string }[];
}

export async function workflowNameClash(
  db: Queryable,
  check: WorkflowNameCheck,
): Promise<string | null> {
  const wanted = nameKey(check.name);
  const saved = check.saved.find((flow) => flow.id !== check.id && nameKey(flow.name) === wanted);
  if (saved) return `The workflow ${saved.id} is already named ${saved.name}. Pick another name.`;
  const drafts = await pendingCrewCards(db, check.workspaceId);
  const draft = drafts.find(
    (card) =>
      card.action.action === 'crew_edit' &&
      card.action.target === 'workflow' &&
      card.action.id !== check.id &&
      nameKey(card.action.name) === wanted,
  );
  if (draft) return draftClash('workflow', check.name, draft, check.conversationId);
  return null;
}

const DRAFT_KINDS: Record<CrewAction['action'], string> = {
  create_teammate: 'new Spark',
  update_teammate: 'Spark change',
  delete_teammate: 'Spark delete',
  crew_edit: 'files',
};

function draftKind(action: CrewAction): string {
  if (action.action !== 'crew_edit') return DRAFT_KINDS[action.action];
  const what = action.target === 'spark' ? 'Spark files' : 'workflow';
  const verb = action.files.every((file) => file.change === 'new')
    ? 'new'
    : action.files.every((file) => file.change === 'deleted')
      ? 'delete'
      : 'change';
  return `${what} ${verb}`;
}

function draftContent(action: CrewAction): Record<string, unknown> {
  if (action.action === 'crew_edit') {
    return { files: action.files.map((file) => ({ path: file.path, text: file.after })) };
  }
  if (action.action === 'delete_teammate') return {};
  return { role: action.role, instructions: action.instructions };
}

export function draftsView(cards: readonly PendingCrewCard[], conversationId: string | null) {
  return cards.map((card) => {
    const own = card.conversationId === conversationId;
    return {
      draftId: card.id,
      kind: draftKind(card.action),
      name: card.action.name,
      chat: own ? 'this chat' : 'another chat',
      ...(own ? draftContent(card.action) : {}),
    };
  });
}

export const DRAFTS_NOTE =
  'Drafts wait for the user. Change one from this chat by proposing it again; withdraw with spark_crew_edit withdraw. Another chat’s drafts are the user’s to deny.';
