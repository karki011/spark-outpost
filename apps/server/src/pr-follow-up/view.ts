import { PR_FOLLOW_UP_MAX_ROUNDS, type PrWatch } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import {
  feedbackFor,
  feedbackView,
  watchesForConversation,
  type Watch,
} from '../persistence/pr-watches.ts';

const OPEN_STATES = new Set(['queued', 'held', 'needs_user', 'in_round', 'planned']);

export async function watchView(db: Queryable, watch: Watch, excerptChars?: number) {
  const items = await feedbackFor(db, watch.id);
  const view: PrWatch = {
    id: watch.id,
    conversationId: watch.conversationId,
    repo: `${watch.owner}/${watch.repo}`,
    number: watch.number,
    url: watch.url,
    branch: watch.branch,
    phase: watch.phase,
    doing: watch.doing,
    prState: watch.prState,
    draft: watch.draft,
    checks: watch.checks,
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
  const watches = await watchesForConversation(db, workspaceId, conversationId);
  return Promise.all(watches.map((watch) => watchView(db, watch)));
}
