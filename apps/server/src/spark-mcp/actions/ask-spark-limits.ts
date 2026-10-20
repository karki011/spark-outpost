import {
  holdsToConfirm,
  type Approval,
  type AssistantActs,
  type SparkAction,
} from '@spark-outpost/contracts';
import { getApproval } from '../../persistence/approvals.ts';
import type { Queryable } from '../../persistence/db.ts';
import {
  cardSwitch,
  macOnlyCard,
  MAC_CARD_REFUSAL,
  remoteDecision,
  switchRefusal,
} from '../../remote/policy.ts';
import { CARD_ROUTE } from '../../remote/route-rules.ts';
import { runFromDevice } from '../../remote/run-mark.ts';
import { remoteAccess } from '../../remote/store.ts';
import type { ActionPath } from './action-policy.ts';

export const ASK_SPARK_REFUSALS = {
  voice:
    'Ask Spark never answers an approval card from a spoken question. Answer the card yourself.',
  ownCard: 'Ask Spark does not answer its own cards.',
  held: 'This card needs you to press and hold, so it stays with you. Answer it yourself in the chat.',
  instructions:
    'This card changes an agent instruction file, so it stays with you. Answer it yourself in the chat.',
  macOnly: 'Mac control, calendar and browser sign-in cards stay with you. Answer it yourself.',
  notWaiting: 'That card is no longer waiting for an answer.',
  noOption: 'This card has no Allow once or Deny answer, so it stays with you.',
  terminal: 'Ask Spark does not act on Terminal sessions. Use the session itself.',
  assistantChat: 'Ask Spark does not act on its own conversation.',
} as const;

interface Route {
  method: string;
  path: string;
}

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

function routeOf(action: SparkAction): Route | null {
  if (action.action === 'comment_ticket') {
    return { method: 'POST', path: `/api/tickets/linear/${PLACEHOLDER}/comments` };
  }
  if (action.action === 'transition_ticket') {
    return { method: 'POST', path: `/api/tickets/linear/${PLACEHOLDER}/transition` };
  }
  if (action.action !== 'ask_spark') return null;
  switch (action.op) {
    case 'start_chat':
      return { method: 'POST', path: '/api/conversations' };
    case 'send_message':
      return { method: 'POST', path: `/api/conversations/${PLACEHOLDER}/queue` };
    case 'stop_turn':
      return { method: 'POST', path: `/api/runs/${PLACEHOLDER}/cancel` };
    case 'archive_chat':
      return { method: 'PATCH', path: `/api/conversations/${PLACEHOLDER}` };
    case 'answer_card': {
      const [method, path] = CARD_ROUTE.split(' ') as [string, string];
      return { method, path: path.replace(':id', PLACEHOLDER) };
    }
    case 'pause_spark':
    case 'resume_spark':
      return { method: 'PUT', path: '/api/spark-pause' };
    case 'start_ticket':
      return { method: 'POST', path: `/api/tickets/linear/${PLACEHOLDER}/start` };
  }
}

export function cardRefusal(
  approval: Approval | null,
  cardChat: string | null,
  assistantChat: string | null,
): string | null {
  if (!approval || approval.status !== 'pending') return ASK_SPARK_REFUSALS.notWaiting;
  if (cardChat !== null && cardChat === assistantChat) return ASK_SPARK_REFUSALS.ownCard;
  if (holdsToConfirm(approval.payload)) return ASK_SPARK_REFUSALS.held;
  if (approval.payload.instructionFiles !== undefined) return ASK_SPARK_REFUSALS.instructions;
  if (macOnlyCard(approval.payload)) return ASK_SPARK_REFUSALS.macOnly;
  if (approval.payload.sparkAction?.action === 'browser_sign_in') return ASK_SPARK_REFUSALS.macOnly;
  const answers = new Set(approval.options.map((option) => option.kind));
  if (!answers.has('allow_once') || !answers.has('reject_once')) return ASK_SPARK_REFUSALS.noOption;
  return null;
}

async function chatOfRun(db: Queryable, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.conversation_id ?? null;
}

export async function assistantChatOf(db: Queryable, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string | null }>(
    'SELECT assistant_conversation_id AS id FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.id ?? null;
}

export async function cardRefusalFor(
  db: Queryable,
  workspaceId: string,
  approvalId: string,
): Promise<{ approval: Approval | null; refusal: string | null }> {
  const approval = await getApproval(db, approvalId);
  const cardChat = approval ? await chatOfRun(db, approval.runId) : null;
  const assistant = await assistantChatOf(db, workspaceId);
  const owned = cardChat !== null && (await chatInWorkspace(db, workspaceId, cardChat));
  return { approval, refusal: cardRefusal(owned ? approval : null, cardChat, assistant) };
}

async function chatInWorkspace(db: Queryable, workspaceId: string, chatId: string) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
    [chatId, workspaceId],
  );
  return rowCount === 1;
}

export async function spokenRun(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ spoken: boolean }>(
    `SELECT COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
       = 'voice' AS spoken FROM runs r WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.spoken === true;
}

async function deviceRefusal(
  db: Queryable,
  workspaceId: string,
  runId: string,
  action: SparkAction,
  card: Approval | null,
): Promise<string | null> {
  if (!(await runFromDevice(db, runId))) return null;
  const route = routeOf(action);
  if (!route) return 'This is only available on your Mac.';
  const { switches } = await remoteAccess(db, workspaceId);
  const decision = remoteDecision(route.method, route.path, switches);
  if (decision.kind !== 'allow') {
    return decision.kind === 'refuse' ? decision.reason : 'This is only available on your Mac.';
  }
  if (!card) return null;
  if (macOnlyCard(card.payload)) return MAC_CARD_REFUSAL;
  const needed = cardSwitch(card.payload);
  return needed && !switches[needed] ? switchRefusal(needed) : null;
}

export async function assistantRefusal(
  db: Queryable,
  workspaceId: string,
  runId: string,
  action: SparkAction,
): Promise<string | null> {
  const answering = action.action === 'ask_spark' && action.op === 'answer_card';
  let card: Approval | null = null;
  if (answering) {
    if (await spokenRun(db, runId)) return ASK_SPARK_REFUSALS.voice;
    const checked = await cardRefusalFor(db, workspaceId, action.approvalId ?? PLACEHOLDER);
    if (checked.refusal) return checked.refusal;
    card = checked.approval;
  }
  return deviceRefusal(db, workspaceId, runId, action, card);
}

export async function assistantActs(db: Queryable, workspaceId: string): Promise<AssistantActs> {
  const { rows } = await db.query<{ acts: AssistantActs }>(
    'SELECT assistant_acts AS acts FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.acts ?? 'manual';
}

const ASKS_TO_ANSWER = /\b(allow|approve|accept|confirm|deny|reject|decline|answer)\b/i;

export function askedToAnswer(question: string): boolean {
  return ASKS_TO_ANSWER.test(question);
}

async function questionOf(db: Queryable, runId: string): Promise<string> {
  const { rows } = await db.query<{ content: string }>(
    'SELECT m.content FROM runs r JOIN messages m ON m.id = r.user_message_id WHERE r.id = $1',
    [runId],
  );
  return rows[0]?.content ?? '';
}

export async function assistantPath(
  db: Queryable,
  workspaceId: string,
  runId: string,
  action: SparkAction,
): Promise<ActionPath> {
  if ((await assistantActs(db, workspaceId)) !== 'act') return 'confirm';
  const answering = action.action === 'ask_spark' && action.op === 'answer_card';
  if (answering && !askedToAnswer(await questionOf(db, runId))) return 'confirm';
  return 'perform';
}
