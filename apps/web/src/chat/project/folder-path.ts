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
