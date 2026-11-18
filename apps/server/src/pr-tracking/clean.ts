import type { TrackedPull } from '../persistence/tracked-pulls.ts';

const REVIEW_THREAD = 'review_comment:';

export const OPEN_FOLLOW_UP_STATES = ['queued', 'needs_user', 'in_round', 'planned'] as const;

interface ReviewFacts {
  draft: boolean;
  headSha: string | null;
  checks: string | null;
  changesRequested: boolean;
  unresolvedThreads: boolean;
}

export function cleanReview(facts: ReviewFacts): boolean {
  return (
    !facts.draft &&
    facts.headSha !== null &&
    facts.checks === 'passing' &&
    !facts.changesRequested &&
    !facts.unresolvedThreads
  );
}

export function isClean(pull: TrackedPull, openItems: number): boolean {
  const { threads, threadCount } = pull.details;
  return (
    pull.prState === 'open' &&
    pull.followUp &&
    cleanReview({
      draft: pull.draft,
      headSha: pull.headSha,
      checks: pull.checks,
      changesRequested: pull.review === 'changes_requested',
      unresolvedThreads:
        threadCount > threads.length ||
        threads.some((thread) => thread.key.startsWith(REVIEW_THREAD)),
    }) &&
    pull.phase !== 'fixing' &&
    pull.phase !== 'confirming' &&
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
