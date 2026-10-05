import type { Queryable } from './db.ts';

export interface SignInRow {
  id: string;
  project_id: string;
  label: string;
  origin: string;
  keychain_ref: string;
  created_at: Date;
  updated_at: Date;
}

export interface NewSignInRow {
  id: string;
  projectId: string;
  label: string;
  origin: string;
  keychainRef: string;
}

const COLUMNS = 'id, project_id, label, origin, keychain_ref, created_at, updated_at';
const UNIQUE_VIOLATION = '23505';

export class SignInLabelTakenError extends Error {
  constructor() {
    super('This project already has a sign-in with that label.');
  }
}

async function labelChecked<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new SignInLabelTakenError();
    throw error;
  }
}

export async function listSignInRows(db: Queryable, projectId: string): Promise<SignInRow[]> {
  const { rows } = await db.query<SignInRow>(
    `SELECT ${COLUMNS} FROM browser_sign_ins WHERE project_id = $1 ORDER BY lower(label)`,
    [projectId],
  );
  return rows;
}

export async function getSignInRow(
  db: Queryable,
  projectId: string,
  id: string,
): Promise<SignInRow | null> {
  const { rows } = await db.query<SignInRow>(
    `SELECT ${COLUMNS} FROM browser_sign_ins WHERE project_id = $1 AND id = $2`,
    [projectId, id],
  );
  return rows[0] ?? null;
}

export async function insertSignInRow(db: Queryable, row: NewSignInRow): Promise<SignInRow> {
  const { rows } = await labelChecked(
    db.query<SignInRow>(
      `INSERT INTO browser_sign_ins (id, project_id, label, origin, keychain_ref)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [row.id, row.projectId, row.label, row.origin, row.keychainRef],
    ),
  );
  return rows[0]!;
}

export async function updateSignInRow(
  db: Queryable,
  projectId: string,
  id: string,
  change: { label: string; origin: string },
): Promise<SignInRow | null> {
  const { rows } = await labelChecked(
    db.query<SignInRow>(
      `UPDATE browser_sign_ins SET label = $3, origin = $4, updated_at = now()
       WHERE project_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [projectId, id, change.label, change.origin],
    ),
  );
  return rows[0] ?? null;
}

export async function deleteSignInRow(
  db: Queryable,
  projectId: string,
  id: string,
): Promise<SignInRow | null> {
  const { rows } = await db.query<SignInRow>(
    `DELETE FROM browser_sign_ins WHERE project_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [projectId, id],
  );
  return rows[0] ?? null;
}

export async function countSignInRows(db: Queryable, projectId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*) FROM browser_sign_ins WHERE project_id = $1',
    [projectId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function signInRefs(db: Queryable, projectId?: string): Promise<string[]> {
  const { rows } = await db.query<{ keychain_ref: string }>(
    `SELECT keychain_ref FROM browser_sign_ins
     WHERE $1::uuid IS NULL OR project_id = $1 ORDER BY keychain_ref`,
    [projectId ?? null],
  );
  return rows.map((row) => row.keychain_ref);
}
