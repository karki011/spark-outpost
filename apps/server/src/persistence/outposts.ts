import { handleProblem, type OutpostMember } from '@spark-outpost/contracts';
import type { OutpostStore, StoredOutpost } from '../outposts/ports.ts';
import type { Queryable } from './db.ts';

export class OutpostError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

export const OUTPOST_NOT_FOUND = 'That outpost does not exist. It may have been deleted.';
export const CHAT_ALREADY_IN_OUTPOST = 'That chat is already in an outpost.';
export const TERMINAL_CANNOT_JOIN = 'A Terminal session cannot join an outpost.';
export const OUTPOST_ID_IN_USE = 'That outpost id is already in use.';
const CHAT_NOT_FOUND = 'Conversation not found.';
const HANDLE_REFUSED = 'That handle cannot be used.';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const HANDLE_CONSTRAINT = 'outpost_members_handle';

interface OutpostRow {
  id: string;
  name: string;
  paused_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MemberRow {
  outpost_id: string;
  conversation_id: string;
  handle: string;
  position: number;
  joined_at: Date;
}

const OUTPOST_COLUMNS = 'o.id, o.name, o.paused_at, o.created_at, o.updated_at';
const MEMBER_COLUMNS = 'outpost_id, conversation_id, handle, position, joined_at';

function toMember(row: MemberRow): OutpostMember {
  return {
    conversationId: row.conversation_id,
    handle: row.handle,
    position: row.position,
    joinedAt: row.joined_at.toISOString(),
  };
}

function toOutpost(row: OutpostRow, members: OutpostMember[]): StoredOutpost {
  return {
    id: row.id,
    name: row.name,
    pausedAt: row.paused_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    members,
  };
}

async function withMembers(db: Queryable, rows: OutpostRow[]): Promise<StoredOutpost[]> {
  if (rows.length === 0) return [];
  const found = await db.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM outpost_members
     WHERE outpost_id = ANY($1::uuid[]) ORDER BY position, joined_at, conversation_id`,
    [rows.map((row) => row.id)],
  );
  return rows.map((row) =>
    toOutpost(row, found.rows.filter((member) => member.outpost_id === row.id).map(toMember)),
  );
}

async function outpostById(db: Queryable, id: string): Promise<StoredOutpost | null> {
  const { rows } = await db.query<OutpostRow>(
    `SELECT ${OUTPOST_COLUMNS} FROM outposts o WHERE o.id = $1`,
    [id],
  );
  return (await withMembers(db, rows))[0] ?? null;
}

function memberConflict(error: unknown, handle: string): never {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === UNIQUE_VIOLATION && constraint === HANDLE_CONSTRAINT) {
    throw new OutpostError(409, `@${handle} is already used in this outpost.`);
  }
  if (code === UNIQUE_VIOLATION) throw new OutpostError(409, CHAT_ALREADY_IN_OUTPOST);
  if (code === CHECK_VIOLATION) {
    throw new OutpostError(400, handleProblem(handle, []) ?? HANDLE_REFUSED);
  }
  throw error;
}

async function whyNotAdded(
  db: Queryable,
  outpostId: string,
  conversationId: string,
): Promise<OutpostError> {
  const outpost = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM outposts WHERE id = $1',
    [outpostId],
  );
  if (!outpost.rows[0]) return new OutpostError(404, OUTPOST_NOT_FOUND);
  const chat = await db.query<{ session_type: string }>(
    'SELECT session_type FROM conversations WHERE id = $1 AND workspace_id = $2',
    [conversationId, outpost.rows[0].workspace_id],
  );
  if (chat.rows[0]?.session_type === 'terminal') return new OutpostError(409, TERMINAL_CANNOT_JOIN);
  return new OutpostError(404, CHAT_NOT_FOUND);
}

export const getOutpost: OutpostStore['getOutpost'] = async (db, workspaceId, id) => {
  const { rows } = await db.query<OutpostRow>(
    `SELECT ${OUTPOST_COLUMNS} FROM outposts o WHERE o.workspace_id = $1 AND o.id = $2`,
    [workspaceId, id],
  );
  return (await withMembers(db, rows))[0] ?? null;
};

export const listOutposts: OutpostStore['listOutposts'] = async (db, workspaceId) => {
  const { rows } = await db.query<OutpostRow>(
    `SELECT ${OUTPOST_COLUMNS} FROM outposts o WHERE o.workspace_id = $1
     ORDER BY o.created_at, o.id`,
    [workspaceId],
  );
  return withMembers(db, rows);
};

export const addMember: OutpostStore['addMember'] = async (db, outpostId, member) => {
  const inserted = await db
    .query<MemberRow>(
      `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
       SELECT o.id, c.id, $3,
         COALESCE((SELECT MAX(m.position) FROM outpost_members m WHERE m.outpost_id = o.id), 0) + 1
       FROM outposts o JOIN conversations c ON c.workspace_id = o.workspace_id
       WHERE o.id = $1 AND c.id = $2 AND c.session_type <> 'terminal'
       RETURNING ${MEMBER_COLUMNS}`,
      [outpostId, member.conversationId, member.handle],
    )
    .catch((error: unknown) => memberConflict(error, member.handle));
  if (!inserted.rows[0]) throw await whyNotAdded(db, outpostId, member.conversationId);
  return toMember(inserted.rows[0]);
};

export const createOutpost: OutpostStore['createOutpost'] = async (db, input) => {
  const inserted = await db.query(
    `INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.workspaceId, input.name],
  );
  if (inserted.rowCount === 1) {
    for (const member of input.members) await addMember(db, input.id, member);
  }
  const outpost = await getOutpost(db, input.workspaceId, input.id);
  if (!outpost) throw new OutpostError(409, OUTPOST_ID_IN_USE);
  return outpost;
};

export const setName: OutpostStore['setName'] = async (db, workspaceId, id, name) => {
  await db.query(
    'UPDATE outposts SET name = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id, name],
  );
  return getOutpost(db, workspaceId, id);
};

export const setPaused: OutpostStore['setPaused'] = async (db, workspaceId, id, paused) => {
  await db.query(
    `UPDATE outposts
     SET paused_at = CASE WHEN $3::boolean THEN COALESCE(paused_at, now()) END, updated_at = now()
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, paused],
  );
  return getOutpost(db, workspaceId, id);
};

export const deleteOutpost: OutpostStore['deleteOutpost'] = async (db, workspaceId, id) => {
  const { rowCount } = await db.query('DELETE FROM outposts WHERE workspace_id = $1 AND id = $2', [
    workspaceId,
    id,
  ]);
  return rowCount === 1;
};

export const removeMember: OutpostStore['removeMember'] = async (db, outpostId, conversationId) => {
  const { rowCount } = await db.query(
    'DELETE FROM outpost_members WHERE outpost_id = $1 AND conversation_id = $2',
    [outpostId, conversationId],
  );
  return rowCount === 1;
};

export const renameHandle: OutpostStore['renameHandle'] = async (
  db,
  outpostId,
  conversationId,
  handle,
) => {
  const { rows } = await db
    .query<MemberRow>(
      `UPDATE outpost_members SET handle = $3 WHERE outpost_id = $1 AND conversation_id = $2
       RETURNING ${MEMBER_COLUMNS}`,
      [outpostId, conversationId, handle],
    )
    .catch((error: unknown) => memberConflict(error, handle));
  return rows[0] ? toMember(rows[0]) : null;
};

export const outpostOf: OutpostStore['outpostOf'] = async (db, conversationId) => {
  const { rows } = await db.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM outpost_members WHERE conversation_id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) return null;
  const outpost = await outpostById(db, row.outpost_id);
  return outpost ? { outpost, member: toMember(row) } : null;
};

export async function notifyOutpostChanged(
  db: Queryable,
  outpostId: string,
  conversationId: string | null = null,
): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'outpost_changed', conversationId, runId: null, outpostId }),
  ]);
}
