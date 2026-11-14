import { readdirSync } from 'node:fs';
import path from 'node:path';

export type ListEntries = (dir: string) => readonly string[];

function listEntries(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function sparkDataReadRules(
  dataDir: string | null,
  readable: readonly string[],
  list: ListEntries = listEntries,
): string[] {
  if (!dataDir) return [];
  const kept = readable.map((folder) => path.resolve(folder));
  const rules: string[] = [];
  const walk = (dir: string) => {
    for (const name of list(dir)) {
      const entry = path.join(dir, name);
      if (kept.includes(entry)) continue;
      if (kept.some((folder) => folder.startsWith(`${entry}${path.sep}`))) {
        walk(entry);
        continue;
      }
      rules.push(`Read(/${entry})`, `Read(/${entry}/**)`);
    }
  };
  walk(path.resolve(dataDir));
  return rules;
}
