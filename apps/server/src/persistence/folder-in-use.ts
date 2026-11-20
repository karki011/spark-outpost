import { realpath } from 'node:fs/promises';
import { AGENT_TERMINAL_LIVE } from './agent-terminals.ts';
import type { Queryable } from './db.ts';

async function resolved(folder: string): Promise<string> {
  const given = folder.replace(/\/+$/, '');
  return realpath(given).catch(() => given);
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
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
  for (const { path } of rows) {
    if (path && within(await resolved(path), target)) return true;
  }
  return false;
}
