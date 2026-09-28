import type { Db } from '../../apps/server/src/persistence/db.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';

const CLAUDE_MODELS = [
  { id: 'opus[1m]', label: 'Opus 5.5', description: 'Opus 5.5 with 1M context' },
  { id: 'sonnet', label: 'Sonnet 5', description: 'Efficient for routine tasks' },
  { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
];
const CODEX_MODELS = [
  { id: 'gpt-6-astra', label: '6 Astra', description: 'Frontier intelligence.' },
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse model for coding.' },
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast and affordable.' },
];
const ZAI_MODELS = [
  { id: 'opus', label: 'GLM-5.3', description: 'Z.ai GLM for coding and agent work.' },
  { id: 'haiku', label: 'GLM-5.3-Flash', description: 'Fast, cheap GLM.' },
];
const PROVIDERS = {
  claude: { models: CLAUDE_MODELS, model: 'sonnet', method: 'cli' },
  codex: { models: CODEX_MODELS, model: 'gpt-6-sol', method: 'cli' },
  zai: { models: ZAI_MODELS, model: 'opus', method: 'api_key' },
} as const;

type Provider = keyof typeof PROVIDERS;

async function connect(db: Db, workspaceId: string, provider: Provider): Promise<void> {
  const { models, model, method } = PROVIDERS[provider];
  await db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, $2, $4, 'e2e', '[]', $3, 'ask', 'medium', now())
     ON CONFLICT (workspace_id, provider) DO NOTHING`,
    [workspaceId, provider, model, method],
  );
  await db.query(
    `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
     VALUES ($1, $2, $3, '[]', $4) ON CONFLICT (workspace_id, provider) DO NOTHING`,
    [workspaceId, provider, JSON.stringify(models), model],
  );
}

export async function seedWorkspace(db: Db): Promise<string> {
  const workspaceId = await ensureLocalWorkspace(db);
  await db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'E2E User', 'claude', now()) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId],
  );
  await setConnections(db, workspaceId, { jev: true, codex: true, zai: false });
  return workspaceId;
}

export async function setConnections(
  db: Db,
  workspaceId: string,
  wanted: { jev: boolean; codex: boolean; zai: boolean },
): Promise<void> {
  await connect(db, workspaceId, 'claude');
  for (const provider of ['codex', 'zai'] as const) {
    if (wanted[provider]) await connect(db, workspaceId, provider);
    else {
      await db.query('DELETE FROM provider_connections WHERE workspace_id = $1 AND provider = $2', [
        workspaceId,
        provider,
      ]);
    }
  }
  if (wanted.jev) {
    await db.query(
      `INSERT INTO advisor_connections (workspace_id, advisor, method, detail, models, model, verified_at)
       VALUES ($1, 'jev', 'api_key', 'e2e', '[]', 'jev-latest', now())
       ON CONFLICT DO NOTHING`,
      [workspaceId],
    );
  } else {
    await db.query(`DELETE FROM advisor_connections WHERE workspace_id = $1 AND advisor = 'jev'`, [
      workspaceId,
    ]);
  }
}
