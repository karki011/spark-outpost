import type { ModelCardsResponse } from '@spark-outpost/contracts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import { listModelStats } from '../persistence/model-stats.ts';
import { catalog } from '../providers/catalog.ts';
import { modelCardsView, type ProviderSnapshot } from './view.ts';

async function connectedProviders(db: Queryable, workspaceId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ provider: string }>(
    `SELECT provider FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL`,
    [workspaceId],
  );
  return new Set(rows.map((row) => row.provider));
}

async function snapshots(db: Queryable, workspaceId: string): Promise<ProviderSnapshot[]> {
  const connected = await connectedProviders(db, workspaceId);
  return Promise.all(
    catalog.map(async (entry) => {
      const capabilities = await getCapabilities(db, workspaceId, entry.id);
      return {
        provider: entry.id,
        connected: connected.has(entry.id),
        doAvailable: entry.doAvailable,
        models: capabilities?.models ?? [],
        defaultModel: capabilities?.defaultModel ?? null,
      };
    }),
  );
}

export async function loadModelCards(
  db: Queryable,
  workspaceId: string,
  now: Date,
): Promise<ModelCardsResponse> {
  const [providers, stats] = await Promise.all([snapshots(db, workspaceId), listModelStats(db)]);
  return modelCardsView(providers, stats, now);
}
