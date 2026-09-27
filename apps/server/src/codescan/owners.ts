export const CODEOWNERS_PATHS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];

export interface OwnerRule {
  pattern: string;
  owners: string[];
}

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (pattern) rules.push({ pattern, owners: owners.filter((owner) => !owner.startsWith('#')) });
  }
  return rules;
}

function escape(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globBody(glob: string): string {
  return glob
    .split('**')
    .map((part) => escape(part).replaceAll('*', '[^/]*').replaceAll('?', '[^/]'))
    .join('.*');
}

export function patternRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
  const trimmed = pattern.replace(/^\//, '');
  const directory = trimmed.endsWith('/');
  const body = globBody(directory ? trimmed.slice(0, -1) : trimmed);
  const prefix = anchored ? '^' : '(?:^|/)';
  const suffix = directory ? '/' : '(?:$|/)';
  return new RegExp(`${prefix}${body}${suffix}`);
}

export function ownersMatcher(rules: readonly OwnerRule[]): (path: string) => string[] {
  const compiled = rules.map((rule) => ({
    regex: patternRegex(rule.pattern),
    owners: rule.owners,
  }));
  return (path) => {
    for (let index = compiled.length - 1; index >= 0; index -= 1) {
      const rule = compiled[index];
      if (rule?.regex.test(path)) return rule.owners;
    }
    return [];
  };
}
