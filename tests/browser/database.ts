import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CREW_CATALOG,
  FAKE_CLAUDE_BIN,
  FAKE_CODEX_STATE,
  FAKE_GH_STATE,
  TEST_DATABASE_URL,
} from './stub-config.ts';
import { DEFAULT_INVOLVEMENT_LEVEL } from '../../packages/contracts/src/approvals.ts';
import type { InvolvementLevel } from '../../packages/contracts/src/involvement-levels.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { truncateTables } from '../../apps/server/src/persistence/truncate.ts';
import { FAKE_CLAUDE_MODES, FAKE_CODEX_MODES } from '../../apps/server/src/providers/fake.ts';
import { stopLeftoverTerminals } from './leftover-terminals.ts';

export function testDatabaseUrl(): string {
  const url = TEST_DATABASE_URL;
  if (!url)
    throw new Error('Browser tests need TEST_DATABASE_URL. Run pnpm db:setup and pnpm db:up.');
  return url;
}

const FAKE_CLAUDE =
  '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.0 (Claude Code)" && exit 0\nexit 2\n';

export function installFakeClaude(): void {
  mkdirSync(FAKE_CLAUDE_BIN, { recursive: true });
  writeFileSync(path.join(FAKE_CLAUDE_BIN, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
}

export function uninstallFakeClaude(): void {
  rmSync(path.join(FAKE_CLAUDE_BIN, 'claude'), { force: true });
}

export function openTestDb(): Db {
  return createDb(testDatabaseUrl(), { connectTries: 7 });
}

interface ResetOptions {
  onboarded: boolean;
  connected?: ('claude' | 'codex')[];
  jev?: boolean;
  catalog?: boolean;
  defaultLevel?: InvolvementLevel;
}

const RESET_TABLES = [
  'jobs',
  'run_events',
  'messages',
  'runs',
  'conversations',
  'projects',
  'provider_connections',
  'provider_capabilities',
  'provider_model_access',
  'advisor_connections',
  'profiles',
  'github_tokens',
  'github_app_connections',
  'project_clones',
  'ticket_connections',
  'ticket_events',
  'tickets',
  'ticket_development',
  'slack_connections',
  'slack_channels',
  'slack_direct_conversations',
  'slack_events',
  'slack_deliveries',
  'attention_settings',
  'attention_snapshots',
  'map_repos',
  'map_overrides',
  'teammates',
  'outposts',
  'calendar_connection',
  'calendar_calendars',
  'calendar_marks',
];
const LEFTOVER_RUN_WAIT_MS = 5000;

async function stopLeftoverRuns(db: Db): Promise<void> {
  await db.query(
    `UPDATE runs SET cancel_requested_at = COALESCE(cancel_requested_at, now())
     WHERE status IN ('queued', 'running', 'awaiting_approval')`,
  );
  const deadline = Date.now() + LEFTOVER_RUN_WAIT_MS;
  while (Date.now() < deadline) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM jobs WHERE status = 'leased' AND lease_expires_at > now() LIMIT 1`,
    );
    if (!rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

const SEED_MODES = {
  claude: { readOnly: 'plan', defaultMode: 'default', modes: FAKE_CLAUDE_MODES },
  codex: { readOnly: 'read-only', defaultMode: 'agent', modes: FAKE_CODEX_MODES },
};

export async function resetTestDatabase({
  onboarded,
  connected = onboarded ? ['claude'] : [],
  jev = false,
  catalog = false,
  defaultLevel = DEFAULT_INVOLVEMENT_LEVEL,
}: ResetOptions): Promise<void> {
  rmSync(FAKE_CODEX_STATE, { force: true });
  rmSync(FAKE_GH_STATE, { force: true });
  installFakeClaude();
  const db = openTestDb();
  try {
    await stopLeftoverRuns(db);
    await stopLeftoverTerminals(db);
    await truncateTables(db, RESET_TABLES);
    if (!onboarded && connected.length === 0) return;
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO profiles
         (workspace_id, display_name, default_provider, onboarding_completed_at, default_level)
       VALUES ($1, 'Test User', $2, $3, $4)`,
      [workspaceId, connected[0] ?? null, onboarded ? new Date() : null, defaultLevel],
    );
    for (const provider of connected) {
      await db.query(
        `INSERT INTO provider_connections
           (workspace_id, provider, method, detail, models, model, permission, agent_mode,
            effort, verified_at)
         VALUES ($1, $2, 'cli', $3, '[]', NULL, 'ask', $4, 'high', now())`,
        [workspaceId, provider, `${provider} test-fixture`, SEED_MODES[provider].readOnly],
      );
      if (!catalog) continue;
      const models = CREW_CATALOG[provider];
      await db.query(
        `INSERT INTO provider_capabilities
           (workspace_id, provider, models, efforts, default_model, modes, default_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          workspaceId,
          provider,
          JSON.stringify(models),
          JSON.stringify(EFFORTS),
          models[1]!.id,
          JSON.stringify(SEED_MODES[provider].modes),
          SEED_MODES[provider].defaultMode,
        ],
      );
    }
    if (jev) {
      await db.query(
        `INSERT INTO advisor_connections
           (workspace_id, advisor, method, detail, models, model, verified_at)
         VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())`,
        [workspaceId],
      );
    }
  } finally {
    await db.end();
  }
}
