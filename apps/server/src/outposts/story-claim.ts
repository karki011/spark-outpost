import type { FailedMember } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { markStarted, releaseStart } from '../persistence/outpost-drafts.ts';
import { deleteOutpost, notifyOutpostChanged, OutpostError } from '../persistence/outposts.ts';
import type { StoredDraft } from './ports.ts';
import { DRAFT_ALREADY_STARTED } from './story-start.ts';

export interface ClaimDeps {
  db: Queryable;
  workspaceId: string;
}

export interface DraftClaim {
  draftId: string;
  outpostId: string;
  created: boolean;
  first: boolean;
  outpostBefore: string | null;
}

export function nothingStarted(failed: readonly FailedMember[]): string {
  const reasons = failed.map(({ handle, message }) => `@${handle}: ${message}`).join(' ');
  return `No chat started, so nothing was created. ${reasons}`;
}

async function removeCreated({ db, workspaceId }: ClaimDeps, claim: DraftClaim): Promise<void> {
  if (!claim.created) return;
  await deleteOutpost(db, workspaceId, claim.outpostId);
  await notifyOutpostChanged(db, claim.outpostId);
}

export async function claimDraft(
  deps: ClaimDeps,
  draft: Pick<StoredDraft, 'id' | 'startedAt' | 'outpostId'>,
  outpostId: string,
  created: boolean,
): Promise<DraftClaim> {
  const claim: DraftClaim = {
    draftId: draft.id,
    outpostId,
    created,
    first: draft.startedAt === null,
    outpostBefore: draft.outpostId,
  };
  if (await markStarted(deps.db, draft.id, outpostId)) return claim;
  await removeCreated(deps, claim);
  throw new OutpostError(409, DRAFT_ALREADY_STARTED);
}

export async function refuseEmptyStart(
  deps: ClaimDeps,
  claim: DraftClaim,
  failed: readonly FailedMember[],
): Promise<never> {
  if (claim.first) {
    await releaseStart(deps.db, claim.draftId, claim.outpostId, claim.outpostBefore);
  }
  await removeCreated(deps, claim);
  throw new OutpostError(409, nothingStarted(failed));
}
