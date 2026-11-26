import {
  ARTIFACT_SHARE_DAYS,
  ARTIFACT_SHARE_HOSTED_DAYS,
  ARTIFACT_SHARE_UPLOAD_KEY_PATTERN,
  shareServiceOrigin,
  type ArtifactShareService,
} from '@spark-outpost/contracts';
import { cloudflareRow } from '../cloudflare/store.ts';
import type { Queryable } from '../persistence/db.ts';
import { CLOUDFLARE_UPLOAD_KEY_SECRET, type SecretStore } from '../setup/secrets.ts';

export interface ShareTarget {
  service: ArtifactShareService;
  origin: string;
  days: readonly number[];
}

export async function shareTarget(
  db: Queryable,
  workspaceId: string,
  hostedOrigin: string | null,
): Promise<ShareTarget | null> {
  const own = await cloudflareRow(db, workspaceId);
  const ownOrigin = own?.shareArtifacts ? shareServiceOrigin(own.origin) : null;
  if (own && ownOrigin) {
    const days = ARTIFACT_SHARE_DAYS.filter((count) => count <= own.maxDays);
    return { service: 'own', origin: ownOrigin, days };
  }
  return hostedOrigin
    ? { service: 'hosted', origin: hostedOrigin, days: ARTIFACT_SHARE_HOSTED_DAYS }
    : null;
}

export async function storedUploadKey(secrets: SecretStore): Promise<string | null> {
  const key = await secrets.get(CLOUDFLARE_UPLOAD_KEY_SECRET).catch(() => null);
  return key && ARTIFACT_SHARE_UPLOAD_KEY_PATTERN.test(key) ? key : null;
}
