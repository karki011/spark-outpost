import type { TrackedPull } from '../persistence/tracked-pulls.ts';

const REVIEW_THREAD = 'review_comment:';

export const OPEN_FOLLOW_UP_STATES = ['queued', 'needs_user', 'in_round', 'planned'] as const;

export function isClean(pull: TrackedPull, openItems: number): boolean {
  const { threads, threadCount } = pull.details;
  return (
    pull.prState === 'open' &&
    pull.followUp &&
    !pull.draft &&
    pull.headSha !== null &&
    pull.checks === 'passing' &&
    pull.review !== 'changes_requested' &&
    pull.phase !== 'fixing' &&
    pull.phase !== 'confirming' &&
    threadCount <= threads.length &&
    !threads.some((thread) => thread.key.startsWith(REVIEW_THREAD)) &&
    openItems === 0
  );
}

export function withCleanState(pull: TrackedPull, clean: boolean, now: Date): TrackedPull {
  if (!clean) return { ...pull, cleanSince: null };
  if (pull.cleanHeadSha === pull.headSha) return pull;
  return { ...pull, cleanHeadSha: pull.headSha, cleanSince: now };
}

export function shownClean(pull: TrackedPull): boolean {
  return (
    pull.prState === 'open' &&
    pull.cleanSince !== null &&
    pull.headSha !== null &&
    pull.cleanHeadSha === pull.headSha
  );
}
