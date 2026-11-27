import type { Db } from '../persistence/db.ts';
import { CLOUDFLARE_UPLOAD_KEY_SECRET, type SecretStore } from '../setup/secrets.ts';
import { saveCloudflare } from './store.ts';

export interface CloudflareLinkDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
}

export interface CloudflareLink {
  inTurn<T>(work: () => Promise<T>): Promise<T>;
  save(
    origin: string,
    uploadKey: string,
    maxDays: number,
    wanted?: () => boolean,
  ): Promise<boolean>;
}

export function createCloudflareLink(deps: CloudflareLinkDeps): CloudflareLink {
  const { db, workspaceId, secrets } = deps;
  let turn: Promise<unknown> = Promise.resolve();

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = turn.then(work, work);
    turn = next.catch(() => undefined);
    return next;
  };

  const restoreKey = async (previous: string | null) => {
    const restore = previous
      ? secrets.set(CLOUDFLARE_UPLOAD_KEY_SECRET, previous)
      : secrets.delete(CLOUDFLARE_UPLOAD_KEY_SECRET);
    await restore.catch(() => undefined);
  };

  return {
    inTurn,
    save: (origin, uploadKey, maxDays, wanted = () => true) =>
      inTurn(async () => {
        if (!wanted()) return false;
        let previous: string | null;
        try {
          previous = await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET);
          await secrets.set(CLOUDFLARE_UPLOAD_KEY_SECRET, uploadKey);
        } catch {
          return false;
        }
        if (!wanted()) {
          await restoreKey(previous);
          return false;
        }
        try {
          await saveCloudflare(db, workspaceId, origin, maxDays);
        } catch (error) {
          await restoreKey(previous);
          throw error;
        }
        return true;
      }),
  };
}
