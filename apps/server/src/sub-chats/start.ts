import {
  startedSubChatsLine,
  SUB_CHATS_STARTED_ACTIVITY,
  type ChatAskDelivered,
  type ChatRef,
  type PlannedSubChat,
  type StartSubChatsAction,
  type SubChatsStartedActivity,
  type SubChatStartedWith,
} from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import { insertChatAsk } from '../persistence/chat-asks.ts';
import {
  getCapabilities,
  resolveChatSettings,
  updateChatSettings,
} from '../persistence/chat-settings.ts';
import { createConversation } from '../persistence/conversations.ts';
import { withTransaction, type Db, type DbClient, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { insertRunEvent } from '../persistence/run-events.ts';
import { InvalidDefaultError } from '../persistence/setup.ts';
import {
  getSubChat,
  insertSubChat,
  markSubChatStarted,
  SubChatError,
} from '../persistence/sub-chats.ts';
import { chatTarget, type ResolveTarget } from '../workflow/queue-drain.ts';
import { runEvents } from '../workflow/run-events.ts';
import { storedMessage } from './asks.ts';
import { deliverAsk } from './deliver-ask.ts';
import { connectedAgents, isFolder, type FolderExists } from './plan-facts.ts';
import { folderMissing, quoted, startChoices, type PlanAgent } from './plan.ts';

const PROJECT_GONE = 'That project no longer exists.';
export const NOT_THIS_CHATS_SUB_CHAT = 'That chat is not a sub-chat of this chat.';

export type StartedBy = 'user' | 'agent';

export interface StartDeps {
  db: Db;
  workspaceId: string;
  folderExists?: FolderExists;
  resolveTarget?: ResolveTarget;
}

export interface StartRequest {
  action: StartSubChatsAction;
  approvalId: string | null;
  runId: string | null;
  startedBy: StartedBy;
}

export interface StartedPiece extends ChatRef {
  held: boolean;
  already: boolean;
  delivered: ChatAskDelivered | null;
}

export interface SubChatsStarted {
  subChats: StartedPiece[];
  notStarted: { title: string; reason: string }[];
}

class PieceRefusal extends Error {}

function stackedOnMissing(title: string): string {
  return `It is stacked on ${quoted(title)}, which did not start.`;
}

type Attempt<T> = { done: T } | { refusal: string };

async function attempt<T>(work: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { done: await work() };
  } catch (error) {
    const refused =
      error instanceof PieceRefusal ||
      error instanceof SubChatError ||
      error instanceof InvalidDefaultError;
    if (refused) return { refusal: error.message };
    throw error;
  }
}

async function isSubChatOf(db: Queryable, id: string, parentId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM sub_chats WHERE conversation_id = $1 AND parent_conversation_id = $2',
    [id, parentId],
  );
  return rowCount === 1;
}

async function refuseMissingProject(
  { db, workspaceId, folderExists = isFolder }: StartDeps,
  piece: PlannedSubChat,
): Promise<void> {
  const { rows } = await db.query<{ name: string; root_path: string }>(
    'SELECT name, root_path FROM projects WHERE id = $1 AND workspace_id = $2',
    [piece.project.id, workspaceId],
  );
  const project = rows[0];
  if (!project) throw new PieceRefusal(PROJECT_GONE);
  if (!(await folderExists(project.root_path))) throw new PieceRefusal(folderMissing(project.name));
}

async function createChat(
  deps: StartDeps,
  piece: PlannedSubChat,
  agents: readonly PlanAgent[],
): Promise<void> {
  const choices = startChoices(
    piece,
    agents.find((agent) => agent.id === piece.provider),
  );
  if ('problem' in choices) throw new PieceRefusal(choices.problem);
  await refuseMissingProject(deps, piece);
  await withTransaction(deps.db, async (client) => {
    const id = piece.conversationId;
    await createConversation(client, deps.workspaceId, id, { projectIds: [piece.project.id] });
    await updateChatSettings(client, id, {
      provider: piece.provider,
      model: choices.model,
      effort: choices.effort,
      agentMode: piece.agentMode,
      level: piece.level,
    });
    await client.query(`UPDATE conversations SET title = $2, title_source = 'user' WHERE id = $1`, [
      id,
      piece.title,
    ]);
  });
}

async function startedWith(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<SubChatStartedWith> {
  const chosen = await resolveChatSettings(db, conversationId);
  const defaults = chosen.provider ? await getCapabilities(db, workspaceId, chosen.provider) : null;
  const pin = chosen.model === null ? (defaults?.defaultModel ?? null) : null;
  const settings =
    pin === null ? chosen : await updateChatSettings(db, conversationId, { model: pin });
  return {
    provider: settings.provider ?? '',
    model: settings.model,
    effort: settings.effort,
    agentMode: settings.agentMode,
    level: settings.level,
  };
}

async function taskAsk(
  client: DbClient,
  workspaceId: string,
  subChat: { conversationId: string; task: string },
  from: { id: string | null; title: string },
  fromRunId: string | null,
): Promise<string | null> {
  const askId = newId();
  if (!(await markSubChatStarted(client, subChat.conversationId, askId))) return null;
  await insertChatAsk(client, {
    id: askId,
    workspaceId,
    kind: 'task',
    fromConversationId: from.id,
    fromRunId,
    fromTitle: from.title,
    toConversationId: subChat.conversationId,
    body: storedMessage(subChat.task),
    replyTo: null,
    wantsReply: true,
  });
  return askId;
}

interface Linked {
  held: boolean;
  askId: string | null;
  startedWith: SubChatStartedWith;
}

async function linkPiece(
  deps: StartDeps,
  request: StartRequest,
  piece: PlannedSubChat,
  created: ReadonlySet<string>,
): Promise<Linked> {
  const { action } = request;
  if (piece.stackedOn && !created.has(piece.stackedOn)) {
    const title = action.pieces.find((other) => other.conversationId === piece.stackedOn)?.title;
    throw new PieceRefusal(stackedOnMissing(title ?? ''));
  }
  const startsAfter = piece.startsAfter.filter((id) => created.has(id));
  const held = piece.stackedOn !== null || startsAfter.length > 0;
  return withTransaction(deps.db, async (client) => {
    const settings = await startedWith(client, deps.workspaceId, piece.conversationId);
    await insertSubChat(client, {
      conversationId: piece.conversationId,
      parentConversationId: action.parent.id,
      task: piece.task,
      stackedOn: piece.stackedOn,
      startsAfter,
      startedWith: settings,
      approvalId: request.approvalId,
    });
    const askId = held
      ? null
      : await taskAsk(client, deps.workspaceId, piece, action.parent, request.runId);
    return { held, askId, startedWith: settings };
  });
}

async function dropUnlinkedChat(db: Queryable, conversationId: string): Promise<void> {
  await db.query(
    `DELETE FROM conversations c WHERE c.id = $1
       AND NOT EXISTS (SELECT 1 FROM sub_chats s WHERE s.conversation_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
    [conversationId],
  );
}

async function auditStart(
  db: Db,
  request: StartRequest,
  piece: PlannedSubChat,
  linked: Linked,
): Promise<void> {
  if (!request.runId) return;
  const payload = {
    event: 'sub_chat_started',
    parent: request.action.parent,
    subChat: { id: piece.conversationId, title: piece.title },
    ...linked.startedWith,
    held: linked.held,
    allowedBy: request.startedBy === 'agent' ? 'ran at once (mode)' : 'approved on a card',
  };
  await insertFinishedRunEntries(db, request.runId, [auditEntry(payload)]);
}

function auditEntry(payload: Record<string, unknown>) {
  return {
    at: new Date(),
    direction: 'harness' as const,
    kind: 'notification' as const,
    method: 'spark/sub_chat',
    rpcId: null,
    sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
    truncated: false,
    payload,
  };
}

async function showStartedLine(db: Db, request: StartRequest, started: SubChatsStarted) {
  const { runId } = request;
  const fresh = started.subChats.filter((piece) => !piece.already);
  if (!runId || (fresh.length === 0 && started.notStarted.length === 0)) return;
  const content: SubChatsStartedActivity = {
    subChats: fresh.map(({ id, title, held }) => ({ id, title, held })),
    notStarted: started.notStarted,
  };
  const key = request.approvalId ?? request.action.pieces[0]!.conversationId;
  await withTransaction(db, async (client) => {
    await insertRunEvent(
      client,
      runId,
      runEvents.activity(`${SUB_CHATS_STARTED_ACTIVITY}:${key}`, SUB_CHATS_STARTED_ACTIVITY, {
        ...content,
      }),
    );
    await client.query(`SELECT pg_notify('run_events', $1)`, [runId]);
  });
}

interface Created {
  created: Set<string>;
  already: Set<string>;
  failed: Map<string, string>;
}

async function createChats(
  deps: StartDeps,
  action: StartSubChatsAction,
  made: Created,
): Promise<void> {
  const agents = await connectedAgents(deps.db, deps.workspaceId);
  for (const piece of action.pieces) {
    const id = piece.conversationId;
    if (await isSubChatOf(deps.db, id, action.parent.id)) {
      made.created.add(id);
      made.already.add(id);
      continue;
    }
    const tried = await attempt(() => createChat(deps, piece, agents));
    if ('refusal' in tried) made.failed.set(id, tried.refusal);
    else made.created.add(id);
  }
}

async function alreadyStarted(db: Queryable, ref: ChatRef): Promise<StartedPiece> {
  const stored = await getSubChat(db, ref.id);
  return { ...ref, held: stored?.startedAt === null, already: true, delivered: null };
}

async function dropUnlinkedChats(db: Queryable, made: Created): Promise<void> {
  for (const id of made.created) {
    if (!made.already.has(id)) await dropUnlinkedChat(db, id).catch(() => undefined);
  }
}

async function startPiece(
  deps: StartDeps,
  request: StartRequest,
  piece: PlannedSubChat,
  made: Created,
): Promise<StartedPiece | string> {
  const ref = { id: piece.conversationId, title: piece.title };
  const earlier = made.failed.get(ref.id);
  if (earlier !== undefined) return earlier;
  if (made.already.has(ref.id)) return alreadyStarted(deps.db, ref);
  const linked = await attempt(() => linkPiece(deps, request, piece, made.created));
  if ('refusal' in linked) {
    made.created.delete(ref.id);
    await dropUnlinkedChat(deps.db, ref.id);
    return linked.refusal;
  }
  const { done } = linked;
  await auditStart(deps.db, request, piece, done).catch(() => undefined);
  const delivered = done.askId
    ? await deliverAsk(deps.db, done.askId, deps.resolveTarget ?? chatTarget(deps.db))
    : null;
  return { ...ref, held: done.held, already: false, delivered };
}

export async function startSubChats(
  deps: StartDeps,
  request: StartRequest,
): Promise<SubChatsStarted> {
  const made: Created = { created: new Set(), already: new Set(), failed: new Map() };
  const result: SubChatsStarted = { subChats: [], notStarted: [] };
  try {
    await createChats(deps, request.action, made);
    for (const piece of request.action.pieces) {
      const started = await startPiece(deps, request, piece, made);
      if (typeof started === 'string') {
        result.notStarted.push({ title: piece.title, reason: started });
      } else {
        result.subChats.push(started);
      }
    }
  } catch (error) {
    await dropUnlinkedChats(deps.db, made);
    throw error;
  }
  await showStartedLine(deps.db, request, result);
  return result;
}

export function startedMessage(started: SubChatsStarted): string {
  const fresh = started.subChats.filter((piece) => !piece.already);
  const titles = (fresh.length > 0 ? fresh : started.subChats).map((piece) => piece.title);
  const line =
    fresh.length === 0 && started.subChats.length > 0
      ? `${startedSubChatsLine(titles)}. They were already started.`
      : `${startedSubChatsLine(titles)}.`;
  const held = fresh.filter((piece) => piece.held).map((piece) => piece.title);
  const reasons = started.notStarted.map(({ title, reason }) => `${quoted(title)}: ${reason}`);
  return [
    line,
    ...(held.length > 0 ? [`Held until what they wait for has reported: ${held.join(', ')}.`] : []),
    ...(reasons.length > 0 ? [`Not started: ${reasons.join(' ')}`] : []),
  ].join(' ');
}

export interface HeldStart {
  started: boolean;
  delivered: ChatAskDelivered | null;
}

interface PlanRecord {
  run_id: string | null;
  title: string;
}

async function planRecord(db: Queryable, conversationId: string): Promise<PlanRecord | null> {
  const { rows } = await db.query<PlanRecord>(
    `SELECT a.run_id, c.title FROM sub_chats s
     JOIN conversations c ON c.id = s.conversation_id
     LEFT JOIN approvals a ON a.id = s.approval_id
     WHERE s.conversation_id = $1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function startHeldSubChat(
  deps: StartDeps,
  conversationId: string,
  how: string,
): Promise<HeldStart> {
  const { db, workspaceId } = deps;
  const stored = await getSubChat(db, conversationId);
  if (!stored) throw new SubChatError(NOT_THIS_CHATS_SUB_CHAT);
  if (stored.startedAt !== null) return { started: false, delivered: null };
  const from = { id: stored.parentConversationId, title: stored.parentTitle };
  const askId = await withTransaction(db, (client) =>
    taskAsk(client, workspaceId, stored, from, null),
  );
  if (!askId) return { started: false, delivered: null };
  const plan = await planRecord(db, conversationId);
  const runId = plan?.run_id ?? null;
  if (plan && runId) {
    const payload = {
      event: 'sub_chat_started',
      parent: from,
      subChat: { id: conversationId, title: plan.title },
      ...stored.startedWith,
      held: false,
      allowedBy: how,
    };
    await insertFinishedRunEntries(db, runId, [auditEntry(payload)]).catch(() => undefined);
  }
  const delivered = await deliverAsk(db, askId, deps.resolveTarget ?? chatTarget(db));
  return { started: true, delivered };
}
