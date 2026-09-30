import type { Project } from './projects.ts';

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderProjectRow(project: Project): string {
  return `<li class="project" data-id="${project.id}"><span class="name">${escapeHtml(project.name)}</span></li>`;
}

export function renderProjectList(projects: readonly Project[]): string {
  if (projects.length === 0) return '<p class="empty">No projects yet.</p>';
  return `<ul class="projects">${projects.map(renderProjectRow).join('')}</ul>`;
}

function budgetBar(spent: number, budget: number | null): string {
  if (budget === null) return '<p class="no-budget">No budget set</p>';
  const percent = Math.min(100, Math.round((spent / budget) * 100));
  const over = spent > budget ? ' over' : '';
  return `<div class="budget-bar${over}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"></div>`;
}

export function renderProjectPage(
  project: Project,
  spent: number,
  budget: number | null = null,
): string {
  return [
    `<section class="project-page" data-id="${project.id}">`,
    `<h1>${escapeHtml(project.name)}</h1>`,
    `<p class="spent">Spent: ${spent}</p>`,
    budgetBar(spent, budget),
    '</section>',
  ].join('');
}
