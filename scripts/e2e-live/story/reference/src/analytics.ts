import type { DatabaseSync } from 'node:sqlite';
import { escapeHtml } from './ui.ts';

export interface AnalyticsRow {
  id: number;
  name: string;
  spent: number;
  budget: number | null;
  overBudget: boolean;
}

export function analyticsRows(db: DatabaseSync): AnalyticsRow[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, COALESCE(SUM(e.amount), 0) AS spent, b.amount AS budget
       FROM projects p LEFT JOIN expenses e ON e.project_id = p.id
       LEFT JOIN project_budgets b ON b.project_id = p.id
       GROUP BY p.id ORDER BY spent DESC, p.name`,
    )
    .all() as { id: number; name: string; spent: number; budget: number | null }[];
  return rows.map((row) => {
    const budget = row.budget === null ? null : Number(row.budget);
    const spent = Number(row.spent);
    return {
      id: Number(row.id),
      name: row.name,
      spent,
      budget,
      overBudget: budget !== null && spent > budget,
    };
  });
}

function renderRow(row: AnalyticsRow): string {
  return [
    `<tr data-id="${row.id}">`,
    `<td class="name">${escapeHtml(row.name)}</td>`,
    `<td class="spent">${row.spent}</td>`,
    row.overBudget ? '<td><span class="badge over-budget">Over budget</span></td>' : '<td></td>',
    '</tr>',
  ].join('');
}

export function renderAnalytics(rows: readonly AnalyticsRow[]): string {
  if (rows.length === 0) return '<p class="empty">No projects yet.</p>';
  return `<table class="analytics"><tbody>${rows.map(renderRow).join('')}</tbody></table>`;
}
