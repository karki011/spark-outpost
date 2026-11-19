import { realpath } from 'node:fs/promises';
import { AGENT_TERMINAL_LIVE } from './agent-terminals.ts';
import type { Queryable } from './db.ts';

const inside = (column: string) =>
  `EXISTS (SELECT 1 FROM unnest($1::text[]) f WHERE ${column} = f OR starts_with(${column}, f || '/'))`;

async function spellings(folder: string): Promise<string[]> {
  const given = folder.replace(/\/+$/, '');
  const resolved = await realpath(given).catch(() => given);
  return [...new Set([given, resolved])];
}

export async function folderInUse(db: Queryable, folder: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM terminal_shells WHERE ${inside('cwd')}
     UNION ALL
     SELECT 1 FROM agent_terminals WHERE ${AGENT_TERMINAL_LIVE} AND ${inside('cwd')}
     UNION ALL
     SELECT 1 FROM native_terminal_sessions
       WHERE state NOT IN ('exited', 'error', 'interrupted') AND ${inside('cwd')}
     UNION ALL
     SELECT 1 FROM preview_servers WHERE wanted = 'running' AND ${inside('folder')}
     LIMIT 1`,
    [await spellings(folder)],
  );
  return rows.length > 0;
}
