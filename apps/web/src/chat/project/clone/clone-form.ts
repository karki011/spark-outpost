import { cloneNameProblem, parseCloneUrl, type CloneJob } from '@spark-outpost/contracts';

export interface CloneForm {
  url: string;
  name: string;
  nameEdited: boolean;
}

export const EMPTY_FORM: CloneForm = { url: '', name: '', nameEdited: false };

export function withUrl(form: CloneForm, url: string): CloneForm {
  if (form.nameEdited) return { ...form, url };
  const parsed = parseCloneUrl(url);
  return { ...form, url, name: parsed.ok ? parsed.source.name : form.name };
}

export function withName(form: CloneForm, name: string): CloneForm {
  return { ...form, name, nameEdited: true };
}

export interface FormProblems {
  url: string | null;
  name: string | null;
}

export function formProblems(form: CloneForm): FormProblems {
  const parsed = parseCloneUrl(form.url);
  return {
    url: form.url.trim() === '' || parsed.ok ? null : parsed.message,
    name: form.name === '' && !form.nameEdited ? null : cloneNameProblem(form.name),
  };
}

export function canClone(form: CloneForm, parent: string | null): boolean {
  return parent !== null && parseCloneUrl(form.url).ok && cloneNameProblem(form.name) === null;
}

export function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, '')}/${name.trim()}`;
}

export function splitDestination(destination: string): { parent: string; name: string } {
  const cut = destination.lastIndexOf('/');
  return { parent: destination.slice(0, cut) || '/', name: destination.slice(cut + 1) };
}

export function formFromJob(job: CloneJob): CloneForm {
  return { url: job.source, name: splitDestination(job.destination).name, nameEdited: true };
}

export function matchingRepos<T extends { slug: string }>(
  repos: readonly T[],
  search: string,
  limit: number,
): T[] {
  const needle = search.trim().toLowerCase();
  const found = needle ? repos.filter((repo) => repo.slug.toLowerCase().includes(needle)) : repos;
  return found.slice(0, limit);
}

export function progressText(job: CloneJob): string {
  return job.percent === null ? job.phase : `${job.phase}, ${job.percent}%`;
}
