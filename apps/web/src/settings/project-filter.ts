import type { Project } from '@spark-outpost/contracts';

export function filterProjects(projects: readonly Project[], filter: string): Project[] {
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...projects];
  return projects.filter((project) => {
    const text = `${project.name} ${project.displayPath} ${project.rootPath}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function openProjectId(
  projects: readonly Project[],
  chosen: string | null | undefined,
): string | null {
  if (chosen !== undefined) return chosen;
  return projects.length === 1 ? projects[0]!.id : null;
}

export function countLabel(shown: number, total: number): string {
  if (shown === total) return `${total} projects`;
  return `${shown} of ${total} projects`;
}
