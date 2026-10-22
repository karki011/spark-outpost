import { ARTIFACT_ACTIVITY, type RunEvent } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { runEvents } from '../workflow/run-events.ts';
import { findVersion } from './store.ts';

export function artifactActivity(artifactId: string, version: number): RunEvent {
  return runEvents.activity(`${ARTIFACT_ACTIVITY}:${artifactId}`, ARTIFACT_ACTIVITY, {
    artifactId,
    version,
  });
}

export async function linkedArtifactActivity(
  db: Queryable,
  conversationId: string,
  link: { conversationId: string; artifactId: string },
): Promise<RunEvent | null> {
  if (link.conversationId !== conversationId) return null;
  const latest = await findVersion(db, link.artifactId, null);
  if (!latest || latest.conversationId !== conversationId) return null;
  return artifactActivity(latest.artifactId, latest.version);
}
