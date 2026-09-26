const ABSOLUTE_PATH = /(^|[\s'"`=(])(\/(?!\/)[^\s'"`)]+)/g;

function canonical(path: string): string {
  return path.replace(/^\/private(?=\/(tmp|var)\/)/, '').replace(/(.)\/+$/, '$1');
}

export function shortPath(path: string, roots: readonly string[]): string {
  const trailing = path.length > 1 && path.endsWith('/') ? '/' : '';
  const bare = canonical(path);
  const bases = roots.map(canonical).toSorted((a, b) => b.length - a.length);
  for (const base of bases) {
    if (bare === base) return `.${trailing}`;
    if (bare.startsWith(`${base}/`)) return `${bare.slice(base.length + 1)}${trailing}`;
  }
  const parts = bare.split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}${trailing}`;
}

export function shortenPaths(text: string, roots: readonly string[]): string {
  return text.replace(ABSOLUTE_PATH, (_match, lead: string, path: string) => {
    return `${lead}${shortPath(path, roots)}`;
  });
}
