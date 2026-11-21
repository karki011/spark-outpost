import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatSettings, StartSubChatsAction } from '@spark-outpost/contracts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { createProject } from '../src/projects/projects.ts';
import { planFacts } from '../src/sub-chats/plan-facts.ts';
import { planSubChats } from '../src/sub-chats/plan.ts';
import { startSubChats } from '../src/sub-chats/start.ts';
import type { ResolveTarget } from '../src/workflow/queue-drain.ts';
import type { TestDb } from './support.ts';

export interface ParentChat {
  id: string;
  projectId: string;
  root: string;
}

export const PARENT_TITLE = 'Checkout rework';

export const PARENT_SETTINGS = {
  provider: 'claude',
  model: 'opus',
  effort: 'high',
  agentMode: 'auto',
  level: 'hands-off',
} as const;

export async function projectAt(t: TestDb, scratch: string, name: string) {
  const root = join(scratch, name);
  await mkdir(root, { recursive: true });
  return { root, id: (await createProject(t.db, t.workspaceId, root)).project.id };
}

export async function parentChat(
  t: TestDb,
  project: { id: string; root: string },
  agentMode: string = PARENT_SETTINGS.agentMode,
): Promise<ParentChat> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, { projectIds: [project.id] });
  await t.db.query('UPDATE conversations SET title = $2 WHERE id = $1', [id, PARENT_TITLE]);
  await updateChatSettings(t.db, id, { ...PARENT_SETTINGS, agentMode });
  return { id, projectId: project.id, root: project.root };
}

export async function userTurn(
  t: TestDb,
  conversationId: string,
  content: string,
  mode: string,
): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content, source: 'ui' },
    { provider: 'fake' },
  );
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [sent.run.id]);
  await t.db.query(
    `UPDATE runs SET provider = 'claude', used_mode = $2, status = 'running' WHERE id = $1`,
    [sent.run.id, mode],
  );
  return sent.run.id;
}

export interface SubChatRecord {
  conversation_id: string;
  title: string;
  position: number;
  stacked_on: string | null;
  starts_after: string[];
  started_at: Date | null;
  started_with: Pick<ChatSettings, 'provider' | 'model' | 'effort' | 'agentMode' | 'level'>;
  approval_id: string | null;
  task_ask_id: string | null;
}

export async function subChatsOf(t: TestDb, parentId: string): Promise<SubChatRecord[]> {
  const { rows } = await t.db.query<SubChatRecord>(
    `SELECT s.conversation_id, c.title, s.position, s.stacked_on, s.starts_after, s.started_at,
       s.started_with, s.approval_id, s.task_ask_id
     FROM sub_chats s JOIN conversations c ON c.id = s.conversation_id
     WHERE s.parent_conversation_id = $1 ORDER BY s.position`,
    [parentId],
  );
  return rows;
}

export const THREE_PIECES = [
  { title: 'Orders API', task: 'Add the orders endpoint with total_cents.' },
  { title: 'Orders page', task: 'Build the orders page.', stackedOn: 'Orders API' },
  { title: 'Docs', task: 'Document both.', startsAfter: ['Orders API', 'Orders page'] },
];

type PieceInput = { title: string; task: string; stackedOn?: string; startsAfter?: string[] };

export async function plannedAction(
  t: TestDb,
  parent: ParentChat,
  pieces: readonly PieceInput[],
): Promise<StartSubChatsAction> {
  const facts = await planFacts(t.db, t.workspaceId, parent.id);
  const plan = planSubChats(
    pieces.map((piece) => ({ ...piece, startsAfter: piece.startsAfter ?? [] })),
    facts,
  );
  if (plan.kind === 'refusal') throw new Error(plan.message);
  return {
    action: 'start_sub_chats',
    parent: { id: parent.id, title: PARENT_TITLE },
    pieces: plan.pieces,
  };
}

export async function startedPlan(
  t: TestDb,
  parent: ParentChat,
  pieces: readonly PieceInput[],
  resolveTarget: ResolveTarget = async () => ({ provider: 'fake' }),
): Promise<SubChatRecord[]> {
  await startSubChats(
    { db: t.db, workspaceId: t.workspaceId, resolveTarget },
    {
      action: await plannedAction(t, parent, pieces),
      approvalId: null,
      runId: null,
      startedBy: 'agent',
    },
  );
  return subChatsOf(t, parent.id);
}
