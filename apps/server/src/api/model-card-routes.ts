import { Router } from 'express';
import { PERMISSION_DO } from '@spark-outpost/contracts';
import { modelCardsView, type ProviderSnapshot } from '../model-cards/view.ts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import { listModelStats } from '../persistence/model-stats.ts';
import { catalog, isSelectablePermission } from '../providers/catalog.ts';

export interface ModelCardRouteDeps {
  db: Db;
  workspaceId: string;
}

async function connectedProviders(db: Db, workspaceId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ provider: string }>(
    `SELECT provider FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL`,
    [workspaceId],
  );
  return new Set(rows.map((row) => row.provider));
}

async function snapshots(db: Db, workspaceId: string): Promise<ProviderSnapshot[]> {
  const connected = await connectedProviders(db, workspaceId);
  return Promise.all(
    catalog.map(async (entry) => {
      const capabilities = await getCapabilities(db, workspaceId, entry.id);
      return {
        provider: entry.id,
        connected: connected.has(entry.id),
        doAvailable: isSelectablePermission(entry, PERMISSION_DO),
        models: capabilities?.models ?? [],
        defaultModel: capabilities?.defaultModel ?? null,
      };
    }),
  );
}

export function modelCardRoutes({ db, workspaceId }: ModelCardRouteDeps): Router {
  const router = Router();

  router.get('/model-cards', async (_req, res) => {
    const [providers, stats] = await Promise.all([snapshots(db, workspaceId), listModelStats(db)]);
    res.json(modelCardsView(providers, stats, new Date()));
  });

  return router;
}
