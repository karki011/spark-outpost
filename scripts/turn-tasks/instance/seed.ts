import { ensureLocalWorkspace } from '../../../apps/server/src/persistence/conversations.ts';
import type { Db } from '../../../apps/server/src/persistence/db.ts';
import { PROVIDER_SETUPS, type Provider } from '../runner/providers.ts';

export async function seedWorkspace(db: Db, provider: Provider, model: string): Promise<string> {
  const workspaceId = await ensureLocalWorkspace(db);
  await db.query(
    `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
     VALUES ($1, 'Turn tasks', $2, now()) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, provider],
  );
  await db.query(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
     VALUES ($1, $2, $3, 'turn-tasks', '[]', $4, 'ask', 'medium', now())
     ON CONFLICT (workspace_id, provider) DO NOTHING`,
    [workspaceId, provider, PROVIDER_SETUPS[provider].method, model],
  );
  await db.query(
    `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
     VALUES ($1, $2, $3, '[]', $4) ON CONFLICT (workspace_id, provider) DO NOTHING`,
    [
      workspaceId,
      provider,
      JSON.stringify([{ id: model, label: model, description: null }]),
      model,
    ],
  );
  return workspaceId;
}
