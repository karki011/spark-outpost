import type { Db } from '../persistence/db.ts';
import { shareSecret, type SecretStore } from '../setup/secrets.ts';
import { SHARE_TIMEOUT_MS, type ShareService } from './share-service.ts';
import { deleteShare, expiredShareIds, orphanShares, stalePendingShareIds } from './share-store.ts';
import { takeDown, takeDownPending } from './shares.ts';

export interface ShareSweepDeps {
  db: Db;
  secrets: SecretStore;
  service: ShareService | null;
}

async function settle(shareId: string, work: () => Promise<void>): Promise<void> {
  await work().catch((error: unknown) => {
    console.error(`Could not clear shared page ${shareId}; the next sweep tries again`, error);
  });
}

export async function sweepShares(deps: ShareSweepDeps): Promise<void> {
  const { db, secrets, service } = deps;
  for (const id of await expiredShareIds(db)) {
    await settle(id, async () => {
      await secrets.delete(shareSecret(id));
      await deleteShare(db, id);
    });
  }
  if (!service) return;
  for (const page of await orphanShares(db)) {
    await settle(page.shareId, () => takeDown({ db, secrets, service }, page));
  }
  for (const id of await stalePendingShareIds(db)) {
    await settle(id, async () => {
      await takeDownPending({ db, secrets, service }, id);
    });
  }
}

export function shareSweeper(deps: ShareSweepDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const loop = async () => {
    do {
      again = false;
      await sweepShares(deps).catch((error: unknown) => {
        console.error('Could not sweep shared pages', error);
      });
    } while (again);
    running = null;
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}

export interface ShareWiring {
  shareService: ShareService;
  sweepShares: () => Promise<void>;
}

export function shareWiring(
  deps: Omit<ShareSweepDeps, 'service'> & { origin: string | null },
): ShareWiring {
  const { origin, ...rest } = deps;
  const shareService = { origin, fetch, timeoutMs: SHARE_TIMEOUT_MS };
  return { shareService, sweepShares: shareSweeper({ ...rest, service: shareService }) };
}
