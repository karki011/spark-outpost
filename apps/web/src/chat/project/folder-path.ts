export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbs(path: string): Crumb[] {
  const parts = path.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ name: '/', path: '/' }];
  parts.forEach((part, index) => {
    crumbs.push({ name: part, path: `/${parts.slice(0, index + 1).join('/')}` });
  });
  return crumbs;
}

export function typedFolderPath(typed: string, home: string | null): string | null {
  const trimmed = typed.trim();
  if (trimmed.startsWith('/')) return trimmed;
  if (!home) return null;
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return `${home}/${trimmed.slice(2)}`;
  return null;
}
