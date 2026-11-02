import type { DigestState, ProviderId } from '@spark-outpost/contracts';
import {
  attentionSnapshot,
  flaggedHash,
  getAttentionSettings,
} from '../persistence/attention-settings.ts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import {
  asLast,
  hasActivitySince,
  lastFlaggedHash,
  latestDigests,
  loadActivity,
  startDigest,
} from '../persistence/digests.ts';
import { getSetupState } from '../persistence/setup.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { buildDigestPrompt } from './input.ts';
import { digestModel } from './model.ts';
import {
  decideDigest,
  DIGEST_MIN_GAP_MS,
  digestSince,
  refreshableAt,
  type BriefTrigger,
} from './policy.ts';
import { computeDigestStats } from './stats.ts';

interface Snapshot {
  state: DigestState;
  provider: ProviderId | null;
  since: Date;
}

async function snapshot(db: Db, workspaceId: string, now: Date): Promise<Snapshot> {
  const [setup, digests] = await Promise.all([
    getSetupState(db, workspaceId),
    latestDigests(db, workspaceId, now),
  ]);
  const provider = setup.profile.defaultProvider;
  const lastReady = digests.lastReady ? new Date(digests.lastReady.createdAt) : null;
  const since = digestSince(lastReady, now);
  const newActivity = await hasActivitySince(db, workspaceId, since);
  const nextAt = refreshableAt(asLast(digests.latest));
  return {
    provider,
    since,
    state: {
      available: provider !== null,
      digest: digests.latest,
      newActivity,
      refreshableAt: nextAt && nextAt > now ? nextAt.toISOString() : null,
    },
  };
}

export async function digestState(db: Db, workspaceId: string, now = new Date()) {
  return (await snapshot(db, workspaceId, now)).state;
}

export async function digestModelFor(db: Db, workspaceId: string, provider: ProviderId) {
  const capabilities = await getCapabilities(db, workspaceId, provider);
  const efforts = capabilities?.efforts.length
    ? capabilities.efforts.map((effort) => effort.id)
    : catalogEntry(provider).efforts.map((effort) => effort.id);
  return digestModel(provider, capabilities?.models ?? [], efforts);
}

const FLAGGED_LIMIT = 12;

export async function requestDigest(
  db: Db,
  workspaceId: string,
  trigger: BriefTrigger,
  timeZone: string,
  now = new Date(),
  morningTime?: string,
): Promise<DigestState> {
  const { state, provider, since } = await snapshot(db, workspaceId, now);
  if (!provider) return state;
  const [settings, attention, lastHash] = await Promise.all([
    getAttentionSettings(db, workspaceId),
    attentionSnapshot(db, workspaceId),
    lastFlaggedHash(db, workspaceId),
  ]);
  if (!settings.briefEnabled) return state;
  const flaggedChanged = attention.hash !== (lastHash ?? flaggedHash([]));
  const autoAfterMs = settings.briefIntervalMinutes ? settings.briefIntervalMinutes * 60_000 : null;
  const changed = state.newActivity || flaggedChanged;
  const decision = decideDigest(
    trigger,
    asLast(state.digest),
    changed,
    now,
    autoAfterMs,
    morningTime,
  );
  if (decision !== 'start') return state;
  const chats = await loadActivity(db, workspaceId, since);
  const flagged = attention.items.slice(0, FLAGGED_LIMIT);
  if (chats.length === 0 && flagged.length === 0) return state;
  const stats = computeDigestStats(chats);
  const { prompt, chatIds } = buildDigestPrompt({
    since: since.toISOString(),
    until: now.toISOString(),
    timeZone,
    chats,
    flagged,
  });
  const model = await digestModelFor(db, workspaceId, provider);
  await startDigest(
    db,
    workspaceId,
    {
      provider,
      model: model.model,
      modelLabel: model.label,
      effort: model.effort,
      since,
      until: now,
      prompt,
      chatIds,
      stats,
      flagged,
      flaggedHash: attention.hash,
    },
    DIGEST_MIN_GAP_MS,
  );
  return digestState(db, workspaceId, now);
}
