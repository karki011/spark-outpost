import { Router } from 'express';
import {
  PERMISSION_DO,
  providerIdSchema,
  setAllowFrontierRequestSchema,
  type ProviderId,
} from '@spark-outpost/contracts';
import { modelCardsView, type ProviderSnapshot } from '../model-cards/view.ts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import { allowFrontier, listModelStats, setAllowFrontier } from '../persistence/model-stats.ts';
import { catalog, isSelectablePermission } from '../providers/catalog.ts';
import { BadRequestError, parseBody } from './validation.ts';

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

function providerParam(value: string | undefined): ProviderId {
  const provider = providerIdSchema.safeParse(value);
  if (!provider.success) throw new BadRequestError('Unknown provider.');
  return provider.data;
}

export function modelCardRoutes({ db, workspaceId }: ModelCardRouteDeps): Router {
  const router = Router();

  router.get('/model-cards', async (_req, res) => {
    const [providers, frontier, stats] = await Promise.all([
      snapshots(db, workspaceId),
      allowFrontier(db, workspaceId),
      listModelStats(db),
    ]);
    res.json(modelCardsView(providers, frontier, stats, new Date()));
  });

  router.put('/model-cards/frontier/:provider', async (req, res) => {
    const provider = providerParam(req.params.provider);
    const { allowed } = parseBody(setAllowFrontierRequestSchema, req);
    res.json({ allowFrontier: await setAllowFrontier(db, workspaceId, provider, allowed) });
  });

  return router;
}
