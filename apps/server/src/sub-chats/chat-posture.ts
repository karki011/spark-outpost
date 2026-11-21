import { modeKind, modePosture, type ModePosture, type ProviderId } from '@spark-outpost/contracts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';

export async function providerModePosture(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId | null,
  mode: string | null,
): Promise<ModePosture> {
  if (!provider) return 'unknown';
  const capabilities = await getCapabilities(db, workspaceId, provider);
  return modePosture(provider, mode, modeKind(capabilities?.modes ?? [], mode));
}
