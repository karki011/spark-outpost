import { realpath } from 'node:fs/promises';
import path, { type PlatformPath } from 'node:path';
import { AGENT_TERMINAL_LIVE } from './agent-terminals.ts';
import type { Queryable } from './db.ts';

async function resolved(folder: string): Promise<string> {
  return realpath(folder).catch(() => folder);
}

export function within(child: string, folder: string, paths: PlatformPath = path): boolean {
  const relative = paths.relative(folder, child);
  if (relative === '') return true;
  if (relative === '..' || relative.startsWith(`..${paths.sep}`)) return false;
  return !paths.isAbsolute(relative);
}

export async function folderInUse(db: Queryable, folder: string): Promise<boolean> {
  const { rows } = await db.query<{ path: string }>(
    `SELECT cwd AS path FROM terminal_shells
     UNION
     SELECT cwd FROM agent_terminals WHERE ${AGENT_TERMINAL_LIVE}
     UNION
     SELECT cwd FROM native_terminal_sessions
       WHERE state NOT IN ('exited', 'error', 'interrupted')
     UNION
     SELECT folder FROM preview_servers WHERE wanted = 'running'`,
  );
  const target = await resolved(folder);
  for (const row of rows) {
    if (row.path && within(await resolved(row.path), target)) return true;
  }
  return false;
}
