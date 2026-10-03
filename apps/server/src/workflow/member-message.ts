import {
  PERMISSION_DO,
  type MemberMessageRequest,
  type MemberMessageResponse,
} from '@spark-outpost/contracts';
import { addToQueue } from '../persistence/chat-queue.ts';
import { sendInTransaction } from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { insertMemberMessage } from '../persistence/member-messages.ts';
import type { ResolveTarget } from './queue-drain.ts';

export class MemberMessageError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);
const CONTINUABLE = new Set(['builder', 'integrator']);

interface Member {
  conversationId: string;
  status: string;
  role: string | null;
  name: string;
}

async function memberOf(db: Queryable, runId: string): Promise<Member> {
  const { rows } = await db.query<{
    conversation_id: string;
    status: string;
    role: string | null;
    name: string | null;
  }>(`SELECT conversation_id, status, role, route->>'name' AS name FROM runs WHERE id = $1`, [
    runId,
  ]);
  const row = rows[0];
  if (!row) throw new MemberMessageError(404, 'That agent does not exist.');
  return {
    conversationId: row.conversation_id,
    status: row.status,
    role: row.role,
    name: row.name ?? 'The agent',
  };
}

async function chatBusy(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       AND status IN ('queued', 'running', 'awaiting_approval')`,
    [conversationId],
  );
  return (rowCount ?? 0) > 0;
}

export function canContinue(role: string | null): boolean {
  return role !== null && CONTINUABLE.has(role);
}

export async function messageMember(
  db: Db,
  runId: string,
  request: MemberMessageRequest,
  resolveTarget: ResolveTarget,
): Promise<MemberMessageResponse> {
  const member = await memberOf(db, runId);
  const { conversationId, name } = member;
  if (ACTIVE.has(member.status)) {
    const message = await insertMemberMessage(db, {
      id: request.id,
      conversationId,
      runId,
      body: request.text,
      urgency: 'next',
    });
    return { message, queued: false, reply: `Sent to ${name}. It reads this at its next step.` };
  }
  if (!request.continue || !canContinue(member.role)) {
    const how = canContinue(member.role)
      ? `Continue ${name} to pick its work back up.`
      : 'Send your message in the chat instead.';
    throw new MemberMessageError(409, `${name} has finished. ${how}`);
  }
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    await client.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
    if (await chatBusy(client, conversationId)) {
      await addToQueue(client, conversationId, {
        id: request.id,
        content: request.text,
        continueRunId: runId,
      });
      return {
        message: null,
        queued: true,
        reply: `Queued: ${name} continues when this turn ends.`,
      };
    }
    const continuing = target.permission === PERMISSION_DO;
    await sendInTransaction(
      client,
      conversationId,
      {
        id: request.id,
        content: request.text,
        ...(continuing ? { startAs: 'continue' as const } : {}),
      },
      target,
    );
    const message = await insertMemberMessage(client, {
      id: request.id,
      conversationId,
      runId,
      body: request.text,
      urgency: 'next',
      status: 'continued',
      messageId: request.id,
    });
    return { message, queued: false, reply: `${name} is continuing.` };
  });
}
