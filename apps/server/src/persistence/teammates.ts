import {
  TEAMMATES_MAX,
  TEAMMATE_STARTER_IDS,
  faceFromName,
  teammateFaceSchema,
  teammateLevelSchema,
  providerIdSchema,
  teammateState,
  type NewTeammate,
  type Teammate,
  type TeammateActivity,
  type TeammateChatSignal,
  type TeammateList,
  type TeammateStarterId,
  type TeammateView,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import { ProjectNotFoundError } from '../projects/projects.ts';

export class TeammateNotFoundError extends Error {
  constructor() {
    super('That Spark was not found.');
  }
}

export class TeammateConflictError extends Error {}

interface TeammateRow {
  id: string;
  name: string;
  role: string;
  face_shape: string | null;
  face_color: string | null;
  provider: string | null;
  model: string | null;
  agent_mode: string | null;
  level: string | null;
  instructions: string;
  instructions_path: string | null;
  home_conversation_id: string | null;
  project_ids: string[];
  created_at: Date;
  updated_at: Date;
}

const UNIQUE_VIOLATION = '23505';

const teammateColumns = `t.id, t.name, t.role, t.face_shape, t.face_color, t.provider, t.model,
  t.agent_mode, t.level, t.instructions, t.instructions_path, t.home_conversation_id, t.created_at, t.updated_at,
  ARRAY(
    SELECT tp.project_id::text FROM teammate_projects tp
    WHERE tp.teammate_id = t.id ORDER BY tp.position
  ) AS project_ids`;

function toTeammate(row: TeammateRow): Teammate {
  const picked = teammateFaceSchema.safeParse({ shape: row.face_shape, color: row.face_color });
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    face: picked.data ?? faceFromName(row.name),
    faceAuto: !picked.success,
    provider: providerIdSchema.safeParse(row.provider).data ?? null,
    model: row.model,
    agentMode: row.agent_mode,
    level: teammateLevelSchema.safeParse(row.level).data ?? null,
    instructions: row.instructions,
    instructionsPath: row.instructions_path,
    projectIds: row.project_ids,
    homeConversationId: row.home_conversation_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getTeammate(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<Teammate> {
  const { rows } = await db.query<TeammateRow>(
    `SELECT ${teammateColumns} FROM teammates t WHERE t.workspace_id = $1 AND t.id = $2`,
    [workspaceId, id],
  );
  if (!rows[0]) throw new TeammateNotFoundError();
  return toTeammate(rows[0]);
}

export async function listTeammates(db: Queryable, workspaceId: string): Promise<Teammate[]> {
  const { rows } = await db.query<TeammateRow>(
    `SELECT ${teammateColumns} FROM teammates t WHERE t.workspace_id = $1
     ORDER BY t.created_at, t.id`,
    [workspaceId],
  );
  return rows.map(toTeammate);
}

async function setTeammateProjects(
  db: Queryable,
  workspaceId: string,
  teammateId: string,
  projectIds: readonly string[],
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM projects WHERE workspace_id = $1 AND id = ANY($2::uuid[])',
    [workspaceId, projectIds],
  );
  if (rows.length !== projectIds.length) throw new ProjectNotFoundError();
  await db.query('DELETE FROM teammate_projects WHERE teammate_id = $1', [teammateId]);
  await db.query(
    `INSERT INTO teammate_projects (teammate_id, project_id, position)
     SELECT $1, linked.id, linked.position - 1
     FROM unnest($2::uuid[]) WITH ORDINALITY AS linked (id, position)`,
    [teammateId, projectIds],
  );
}

function nameTaken(error: unknown, name: string | undefined): never {
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
    throw new TeammateConflictError(`You already have a Spark named ${name ?? 'that'}.`);
  }
  throw error;
}

export async function createTeammate(
  db: Queryable,
  workspaceId: string,
  input: NewTeammate,
): Promise<Teammate> {
  const { rows: counted } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM teammates WHERE workspace_id = $1',
    [workspaceId],
  );
  if ((counted[0]?.count ?? 0) >= TEAMMATES_MAX) {
    throw new TeammateConflictError(`You can have up to ${TEAMMATES_MAX} Sparks.`);
  }
  const id = newId();
  await db
    .query(
      `INSERT INTO teammates (id, workspace_id, name, role, face_shape, face_color, provider, model,
         agent_mode, level, instructions, instructions_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        workspaceId,
        input.name,
        input.role,
        input.face?.shape ?? null,
        input.face?.color ?? null,
        input.provider,
        input.model,
        input.agentMode,
        input.level,
        input.instructions,
        input.instructionsPath ?? null,
      ],
    )
    .catch((error: unknown) => nameTaken(error, input.name));
  if (input.projectIds.length > 0) {
    await setTeammateProjects(db, workspaceId, id, input.projectIds);
  }
  return getTeammate(db, workspaceId, id);
}

const COLUMNS: Record<Exclude<keyof UpdateTeammateRequest, 'face' | 'projectIds'>, string> = {
  name: 'name',
  role: 'role',
  provider: 'provider',
  model: 'model',
  agentMode: 'agent_mode',
  level: 'level',
  instructions: 'instructions',
  instructionsPath: 'instructions_path',
};

export async function updateTeammate(
  db: Queryable,
  workspaceId: string,
  id: string,
  update: UpdateTeammateRequest,
): Promise<Teammate> {
  await getTeammate(db, workspaceId, id);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = update[key as keyof typeof COLUMNS];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length + 2}`);
  }
  if (update.face !== undefined) {
    values.push(update.face?.shape ?? null, update.face?.color ?? null);
    sets.push(`face_shape = $${values.length + 1}`, `face_color = $${values.length + 2}`);
  }
  await db
    .query(
      `UPDATE teammates SET ${[...sets, 'updated_at = now()'].join(', ')}
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, ...values],
    )
    .catch((error: unknown) => nameTaken(error, update.name));
  if (update.projectIds) await setTeammateProjects(db, workspaceId, id, update.projectIds);
  return getTeammate(db, workspaceId, id);
}

export async function deleteTeammate(db: Queryable, workspaceId: string, id: string) {
  const { rowCount } = await db.query('DELETE FROM teammates WHERE workspace_id = $1 AND id = $2', [
    workspaceId,
    id,
  ]);
  if (!rowCount) throw new TeammateNotFoundError();
}

interface SignalRow {
  teammate_id: string;
  conversation_id: string;
  title: string;
  updated_at: Date;
  status: TeammateChatSignal['status'];
  finished_at: Date | null;
  needs_input: boolean;
  has_messages: boolean;
}

async function chatSignals(db: Queryable, workspaceId: string): Promise<SignalRow[]> {
  const { rows } = await db.query<SignalRow>(
    `SELECT c.teammate_id, c.id AS conversation_id, c.title, c.updated_at, r.status,
       r.finished_at,
       COALESCE(r.status = 'awaiting_approval' OR EXISTS (
         SELECT 1 FROM approvals a JOIN runs ar ON ar.id = a.run_id
         WHERE a.status = 'pending' AND (ar.id = r.id OR ar.parent_run_id = r.id)
       ), false) AS needs_input,
       EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id) AS has_messages
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT id, status, finished_at FROM runs
       WHERE conversation_id = c.id AND parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1
     ) r ON true
     WHERE c.workspace_id = $1 AND c.teammate_id IS NOT NULL AND c.archived_at IS NULL`,
    [workspaceId],
  );
  return rows;
}

function lastActivity(rows: readonly SignalRow[]): TeammateActivity | null {
  const latest = rows
    .filter((row) => row.has_messages)
    .reduce<SignalRow | null>(
      (best, row) => (!best || row.updated_at > best.updated_at ? row : best),
      null,
    );
  return latest
    ? {
        conversationId: latest.conversation_id,
        title: latest.title,
        at: latest.updated_at.toISOString(),
      }
    : null;
}

function teammateView(teammate: Teammate, rows: readonly SignalRow[], now: Date): TeammateView {
  const signals = rows.map((row) => ({
    status: row.status,
    needsInput: row.needs_input,
    finishedAt: row.finished_at?.toISOString() ?? null,
  }));
  return {
    ...teammate,
    state: teammateState(signals, now),
    chatCount: rows.filter((row) => row.has_messages).length,
    lastActivity: lastActivity(rows),
  };
}

async function dismissedStarters(db: Queryable, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ dismissed: string[] }>(
    'SELECT dismissed_teammate_starters AS dismissed FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.dismissed ?? [];
}

export async function teammateList(
  db: Queryable,
  workspaceId: string,
  now = new Date(),
): Promise<TeammateList> {
  const [teammates, signals, dismissed] = await Promise.all([
    listTeammates(db, workspaceId),
    chatSignals(db, workspaceId),
    dismissedStarters(db, workspaceId),
  ]);
  const taken = new Set(teammates.map((teammate) => teammate.name.toLowerCase()));
  return {
    teammates: teammates.map((teammate) =>
      teammateView(
        teammate,
        signals.filter((row) => row.teammate_id === teammate.id),
        now,
      ),
    ),
    starters: TEAMMATE_STARTER_IDS.filter(
      (id) => !dismissed.includes(id) && !taken.has(id.toLowerCase()),
    ),
  };
}

export async function dismissStarter(
  db: Queryable,
  workspaceId: string,
  starter: TeammateStarterId,
): Promise<void> {
  await db.query(
    `INSERT INTO profiles (workspace_id, dismissed_teammate_starters) VALUES ($1, ARRAY[$2])
     ON CONFLICT (workspace_id) DO UPDATE SET dismissed_teammate_starters = ARRAY(
       SELECT DISTINCT unnest(profiles.dismissed_teammate_starters || ARRAY[$2])
     )`,
    [workspaceId, starter],
  );
}
