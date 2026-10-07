import { checkCause, type CheckBody, type CheckpointPayload } from '@spark-outpost/contracts';
import { changedFiles, currentBranch } from '../projects/chat-worktrees.ts';
import { headCommit } from '../projects/snapshot.ts';
import { latestChecks } from './check-results.ts';
import { runBase } from './member-prompts.ts';
import type { Session } from './session.ts';

export type CheckTally = CheckpointPayload['checks'];
export type KeptAt = CheckpointPayload['keptAt'];

const SHORT_COMMIT = 7;

export function checkTally(bodies: readonly CheckBody[]): CheckTally {
  const results = latestChecks(bodies).flatMap((body) => body.results);
  const causes = results.map(checkCause);
  const tally = {
    passed: results.filter((result) => result.outcome === 'passed').length,
    failed: causes.filter((cause) => cause === 'change').length,
    unsettled: causes.filter((cause) => cause !== null && cause !== 'change').length,
  };
  return tally.passed + tally.failed + tally.unsettled > 0 ? tally : null;
}

export async function keptAt(s: Session): Promise<KeptAt> {
  const base = await runBase(s).catch(() => null);
  if (!base) return null;
  const [branch, head, uncommitted] = await Promise.all([
    currentBranch(base.root),
    headCommit(base.root),
    changedFiles(base.root).catch(() => null),
  ]);
  const committed = head !== null && uncommitted !== null && uncommitted.length === 0;
  return { branch, commit: committed ? head.slice(0, SHORT_COMMIT) : null };
}
