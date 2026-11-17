import type { Queryable } from '../persistence/db.ts';
import { shareSecret, type SecretStore } from '../setup/secrets.ts';
import type { ShareService } from './share-service.ts';
import {
  deleteShare,
  expiredShareIds,
  orphanShareIds,
  stalePendingShareIds,
} from './share-store.ts';
import { takeDown } from './shares.ts';

export interface ShareSweepDeps {
  db: Queryable;
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
  const unwanted = [...(await orphanShareIds(db)), ...(await stalePendingShareIds(db))];
  for (const id of unwanted) {
    await settle(id, () => takeDown({ db, secrets, service }, id));
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
