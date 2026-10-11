import type { MemberMessageRequest, MemberMessageResponse } from '@spark-outpost/contracts';
import type { Db, Queryable } from '../persistence/db.ts';
import { insertMemberMessage } from '../persistence/member-messages.ts';

export class MemberMessageError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

interface Member {
  conversationId: string;
  status: string;
  name: string;
}

async function memberOf(db: Queryable, runId: string): Promise<Member> {
  const { rows } = await db.query<{
    conversation_id: string;
    status: string;
    name: string | null;
  }>(`SELECT conversation_id, status, route->>'name' AS name FROM runs WHERE id = $1`, [runId]);
  const row = rows[0];
  if (!row) throw new MemberMessageError(404, 'That agent does not exist.');
  return {
    conversationId: row.conversation_id,
    status: row.status,
    name: row.name ?? 'The agent',
  };
}

export async function messageMember(
  db: Db,
  runId: string,
  request: MemberMessageRequest,
): Promise<MemberMessageResponse> {
  const { conversationId, status, name } = await memberOf(db, runId);
  if (!ACTIVE.has(status)) {
    throw new MemberMessageError(
      409,
      `${name} has finished. Send your message in the chat instead.`,
    );
  }
  const message = await insertMemberMessage(db, {
    id: request.id,
    conversationId,
    runId,
    body: request.text,
    urgency: 'next',
  });
  return { message, queued: false, reply: `Sent to ${name}. It reads this at its next step.` };
}
