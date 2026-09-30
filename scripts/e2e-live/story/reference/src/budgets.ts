import type { DatabaseSync } from 'node:sqlite';

export function getBudget(db: DatabaseSync, projectId: number): number | null {
  const row = db
    .prepare('SELECT amount FROM project_budgets WHERE project_id = ?')
    .get(projectId) as { amount: number } | undefined;
  return row ? Number(row.amount) : null;
}

export function setBudget(db: DatabaseSync, projectId: number, amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error('A budget must be a positive whole number.');
  db.prepare(
    `INSERT INTO project_budgets (project_id, amount) VALUES (?, ?)
     ON CONFLICT (project_id) DO UPDATE SET amount = excluded.amount`,
  ).run(projectId, amount);
}
