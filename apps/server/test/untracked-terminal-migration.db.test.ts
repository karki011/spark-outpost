import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo } from './migration-support.ts';

const MIGRATION = '0229_untracked_terminal_providers.sql';

async function terminalChat(db: Db, workspaceId: string, provider: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO conversations (id, workspace_id, title, session_type, terminal_provider)
     VALUES ($1, $2, 'New chat', 'terminal', $3)`,
    [id, workspaceId, provider],
  );
  return id;
}

async function terminalRow(db: Db, conversationId: string, provider: string): Promise<void> {
  await db.query(
    `INSERT INTO native_terminal_sessions (id, conversation_id, provider, state, cwd, label)
     VALUES ($1, $2, $3, 'unknown', '/tmp', 'Spark session')`,
    [randomUUID(), conversationId, provider],
  );
}

describe('upgrading to untracked Terminal agents', () => {
  const state = migratedUpTo(MIGRATION);

  it('keeps Claude and Codex sessions and accepts Gemini CLI, OpenCode and Amp', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const claude = await terminalChat(db, workspaceId, 'claude');
    await terminalRow(db, claude, 'claude');
    await expect(terminalChat(db, workspaceId, 'gemini')).rejects.toThrow(
      /terminal_provider_check/,
    );

    await runMigrations(db);

    for (const provider of ['gemini', 'opencode', 'amp']) {
      const chat = await terminalChat(db, workspaceId, provider);
      await terminalRow(db, chat, provider);
    }
    const { rows } = await db.query<{ provider: string }>(
      'SELECT provider FROM native_terminal_sessions ORDER BY provider',
    );
    expect(rows.map((row) => row.provider)).toEqual(['amp', 'claude', 'gemini', 'opencode']);
  });

  it('still refuses an agent Spark does not know', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await runMigrations(db);

    await expect(terminalChat(db, workspaceId, 'cursor')).rejects.toThrow(
      /terminal_provider_check/,
    );
    const chat = await terminalChat(db, workspaceId, 'codex');
    await expect(terminalRow(db, chat, 'cursor')).rejects.toThrow(/sessions_provider_check/);
  });
});
