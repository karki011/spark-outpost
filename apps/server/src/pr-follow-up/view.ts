import { PR_FOLLOW_UP_MAX_ROUNDS, type PrWatch } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { feedbackFor, feedbackView } from '../persistence/pr-watches.ts';
import { trackedPullsOf, type TrackedPull } from '../persistence/tracked-pulls.ts';

const OPEN_STATES = new Set(['queued', 'held', 'needs_user', 'in_round', 'planned']);

export async function watchView(db: Queryable, watch: TrackedPull, excerptChars?: number) {
  const items = await feedbackFor(db, watch.id);
  const view: PrWatch = {
    id: watch.id,
    conversationId: watch.conversationId,
    repo: `${watch.owner}/${watch.repo}`,
    number: watch.number,
    url: watch.url,
    title: watch.title,
    branch: watch.branch,
    base: watch.base,
    outside: watch.outside,
    followUp: watch.followUp,
    opened: {
      via: watch.openedVia,
      by: watch.openedBy,
      runId: watch.openedRunId,
      at: watch.openedAt.toISOString(),
    },
    phase: watch.phase,
    doing: watch.doing,
    prState: watch.prState,
    draft: watch.draft,
    checks: watch.checks,
    failingChecks: watch.failingChecks,
    review: watch.review,
    unknownReason: watch.statusReason,
    rounds: watch.rounds,
    maxRounds: PR_FOLLOW_UP_MAX_ROUNDS,
    newComments: items.filter((item) => item.kind !== 'check' && OPEN_STATES.has(item.state))
      .length,
    approvalId: watch.approvalId,
    lastPolledAt: watch.lastPolledAt?.toISOString() ?? null,
    lastError: watch.lastError,
    items: items.map((item) => feedbackView(item, excerptChars)),
  };
  return view;
}

export async function conversationWatches(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<PrWatch[]> {
  const watches = await trackedPullsOf(db, workspaceId, conversationId);
  return Promise.all(watches.map((watch) => watchView(db, watch)));
}
