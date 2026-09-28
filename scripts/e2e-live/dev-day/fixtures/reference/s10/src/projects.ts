import type { DatabaseSync } from 'node:sqlite';

export interface Project {
  id: number;
  name: string;
  budget: number;
}

export interface Expense {
  id: number;
  projectId: number;
  amount: number;
  note: string;
  createdAt: number;
}

export function createProject(db: DatabaseSync, name: string, budget = 0): Project {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A project needs a name.');
  const result = db
    .prepare('INSERT INTO projects (name, budget) VALUES (?, ?)')
    .run(trimmed, budget);
  return { id: Number(result.lastInsertRowid), name: trimmed, budget };
}

export function listProjects(db: DatabaseSync): Project[] {
  return db
    .prepare('SELECT id, name, budget FROM projects ORDER BY name')
    .all() as unknown as Project[];
}

export function getProject(db: DatabaseSync, id: number): Project | null {
  const row = db.prepare('SELECT id, name, budget FROM projects WHERE id = ?').get(id);
  return (row as unknown as Project | undefined) ?? null;
}

export function addExpense(
  db: DatabaseSync,
  projectId: number,
  amount: number,
  note = '',
  createdAt = Date.now(),
): Expense {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error('Amount must be a positive whole number.');
  if (!getProject(db, projectId)) throw new Error(`No project ${projectId}.`);
  const result = db
    .prepare(
      'INSERT INTO expenses (project_id, amount_cents, note, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(projectId, amount, note, createdAt);
  return { id: Number(result.lastInsertRowid), projectId, amount, note, createdAt };
}

export function projectTotal(db: DatabaseSync, projectId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses WHERE project_id = ?')
    .get(projectId) as { total: number };
  return Number(row.total);
}
