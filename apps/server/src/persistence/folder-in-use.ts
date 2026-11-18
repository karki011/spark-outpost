import { AGENT_TERMINAL_LIVE } from './agent-terminals.ts';
import type { Queryable } from './db.ts';

const inside = (column: string) => `(${column} = $1 OR starts_with(${column}, $1 || '/'))`;

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
    [folder.replace(/\/+$/, '')],
  );
  return rows.length > 0;
}
