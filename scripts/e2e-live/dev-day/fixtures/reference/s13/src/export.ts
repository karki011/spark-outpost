import type { DatabaseSync } from 'node:sqlite';

function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function expensesCsv(db: DatabaseSync, projectId: number): string {
  const rows = db
    .prepare(
      'SELECT id, created_at, amount_cents, note FROM expenses WHERE project_id = ? ORDER BY created_at, id',
    )
    .all(projectId) as { id: number; created_at: number; amount_cents: number; note: string }[];
  const lines = rows.map((row) =>
    [row.id, row.created_at, row.amount_cents, field(row.note)].join(','),
  );
  return ['id,created_at,amount,note', ...lines].map((line) => `${line}\n`).join('');
}
