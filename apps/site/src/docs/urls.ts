export const LANDING_SLUG = 'welcome';
export const DOCS_BASE = '/docs/';
export const IMAGE_BASE = `${DOCS_BASE}images/`;

export function docFile(slug: string): string {
  return slug === LANDING_SLUG ? 'index.html' : `${slug}.html`;
}

export function docHref(slug: string, anchor: string | null = null): string {
  const path = slug === LANDING_SLUG ? DOCS_BASE : `${DOCS_BASE}${slug}.html`;
  return anchor ? `${path}#${anchor}` : path;
}

export function slugForPath(pathname: string): string | null {
  if (pathname === DOCS_BASE || pathname === `${DOCS_BASE}index.html`) return LANDING_SLUG;
  const match = /^\/docs\/([a-z0-9-]+)\.html$/.exec(pathname);
  return match ? match[1]! : null;
}
