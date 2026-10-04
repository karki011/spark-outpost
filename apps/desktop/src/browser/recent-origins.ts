import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'browser-origins.json';
const PROJECTS_MAX = 200;

export interface RecentOrigins {
  get(projectId: string): string | null;
  note(projectId: string, origin: string): void;
}

function parse(text: string): Map<string, string> {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object') return new Map();
    return new Map(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return new Map();
  }
}

export async function loadRecentOrigins(
  userData: string,
  log: (line: string) => void,
): Promise<RecentOrigins> {
  const file = path.join(userData, FILE_NAME);
  const origins = parse(await readFile(file, 'utf8').catch(() => '{}'));
  let saving = Promise.resolve();
  return {
    get: (projectId) => origins.get(projectId) ?? null,
    note(projectId, origin) {
      if (origins.get(projectId) === origin) return;
      origins.delete(projectId);
      origins.set(projectId, origin);
      while (origins.size > PROJECTS_MAX) origins.delete(origins.keys().next().value!);
      const text = JSON.stringify(Object.fromEntries(origins));
      saving = saving
        .then(() => writeFile(file, text, { mode: 0o600 }))
        .catch((error: Error) => log(`Could not save recent origins: ${error.message}`));
    },
  };
}
