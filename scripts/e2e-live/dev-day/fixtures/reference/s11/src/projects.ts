import type { DatabaseSync } from 'node:sqlite';

export interface Project {
  id: number;
  name: string;
  budget: number;
  tags: string[];
}

export interface Expense {
  id: number;
  projectId: number;
  amount: number;
  note: string;
  createdAt: number;
}

export function tagsOf(db: DatabaseSync, projectId: number): string[] {
  return (
    db.prepare('SELECT tag FROM project_tags WHERE project_id = ? ORDER BY tag').all(projectId) as {
      tag: string;
    }[]
  ).map((row) => row.tag);
}

export function normaliseTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) throw new Error('tags must be a list.');
  const clean = tags.map((tag) => {
    if (typeof tag !== 'string' || !tag.trim()) throw new Error('Each tag must be a word.');
    return tag.trim().toLowerCase();
  });
  return [...new Set(clean)].sort();
}

export function setTags(db: DatabaseSync, projectId: number, tags: unknown): string[] {
  const clean = normaliseTags(tags);
  db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId);
  const insert = db.prepare('INSERT INTO project_tags (project_id, tag) VALUES (?, ?)');
  for (const tag of clean) insert.run(projectId, tag);
  return clean;
}

export function createProject(db: DatabaseSync, name: string, budget = 0): Project {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A project needs a name.');
  const result = db
    .prepare('INSERT INTO projects (name, budget) VALUES (?, ?)')
    .run(trimmed, budget);
  return { id: Number(result.lastInsertRowid), name: trimmed, budget, tags: [] };
}

export function listProjects(db: DatabaseSync): Project[] {
  const rows = db
    .prepare('SELECT id, name, budget FROM projects ORDER BY name')
    .all() as unknown as Omit<Project, 'tags'>[];
  return rows.map((row) => ({ ...row, tags: tagsOf(db, row.id) }));
}

export function getProject(db: DatabaseSync, id: number): Project | null {
  const row = db.prepare('SELECT id, name, budget FROM projects WHERE id = ?').get(id) as
    Omit<Project, 'tags'> | undefined;
  return row ? { ...row, tags: tagsOf(db, row.id) } : null;
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
