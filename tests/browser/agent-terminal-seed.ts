import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAgentTerminal } from '../../apps/server/src/persistence/agent-terminals.ts';
import { openTestDb } from './database.ts';

export const SERVE = 'sh serve.sh';
export const BUILD = 'sh build.sh';

const SCRIPTS: Record<string, string> = {
  'serve.sh': `echo "Harbor Light is up"
i=0
while true; do
  i=$((i + 1))
  echo "tick $i"
  sleep 0.3
done
`,
  'build.sh': `echo "built 42 files"
exit 3
`,
};

export function agentTerminalFolder(): { folder: string; remove: () => void } {
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-agent-terminal-')));
  for (const [name, script] of Object.entries(SCRIPTS)) {
    writeFileSync(path.join(folder, name), script);
  }
  return { folder, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

let seeded = 0;

export async function seedAgentTerminal(folder: string, command: string): Promise<string> {
  const db = openTestDb();
  try {
    const latest = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE parent_run_id IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    seeded += 1;
    const started = await startAgentTerminal(db, {
      runId: latest.rows[0]!.id,
      toolCallId: `browser-seed-${Date.now()}-${seeded}`,
      name: command,
      command,
      cwd: folder,
      decidedBy: 'mode',
      approvalId: null,
      textOffset: null,
      textBefore: null,
      textHeld: null,
    });
    return started!.row.id;
  } finally {
    await db.end();
  }
}

export async function stopSeededTerminals(): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE agent_terminals SET wanted = 'stopped', stopped_by = COALESCE(stopped_by, 'quit')
       WHERE status IN ('starting', 'running')`,
    );
  } finally {
    await db.end();
  }
}
