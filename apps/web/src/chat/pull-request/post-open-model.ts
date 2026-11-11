import type { PrWatch } from '@spark-outpost/contracts';
import type { FollowUpMode } from './watch-indicator-model.ts';

export const OFFER_LINE = 'Follow up on this PR?';
const OFFER_NOTES: Record<Exclude<FollowUpMode, 'on'>, string> = {
  off: 'Turns on Follow up on pull requests in Settings, for every pull request.',
  ask: 'Turns off Ask before pushing and replying in Settings, for every pull request.',
};

export const offerNote = (mode: FollowUpMode) => (mode === 'on' ? '' : OFFER_NOTES[mode]);
export const CLEAN_LINE = 'PR is clean · ready to merge';

const OPENED_HERE = new Set<PrWatch['opened']['via']>(['ship', 'agent']);

export function offersFollowUp(watch: PrWatch, mode: FollowUpMode): boolean {
  return (
    mode !== 'on' && watch.followUp && watch.prState === 'open' && OPENED_HERE.has(watch.opened.via)
  );
}

export const offerKey = (watch: Pick<PrWatch, 'id'>) => `offer:${watch.id}`;

export function ticketLines(watch: Pick<PrWatch, 'ticketSync'>): string[] {
  return watch.ticketSync
    .filter((entry) => entry.outcome !== 'succeeded')
    .map(
      (entry) =>
        `${entry.key} was not moved to review: ${entry.message ?? 'the ticket system did not take the move.'}`,
    );
}

export interface OpenedSummary {
  title: string;
  sharedRepo: string | null;
}

export function openedSummary(watches: readonly Pick<PrWatch, 'repo'>[]): OpenedSummary {
  const repos = new Set(watches.map((watch) => watch.repo));
  return {
    title: watches.length === 1 ? 'Opened pull request' : `Opened ${watches.length} pull requests`,
    sharedRepo: repos.size === 1 ? [...repos][0]! : null,
  };
}
