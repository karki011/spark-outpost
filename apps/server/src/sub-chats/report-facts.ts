import type { SubChatRow } from '@spark-outpost/contracts';
import { primaryChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { branchWork, type BranchWork } from '../workflow/publish-step-work.ts';
import type { ReportFacts } from './report.ts';

export type ReadBranchWork = (root: string, branch: string, base: string) => Promise<BranchWork>;

type BranchRecord = Pick<ReportFacts, 'committed' | 'pushed'>;

const NOT_KNOWN: BranchRecord = { committed: false, pushed: false };

async function branchRecord(
  db: Queryable,
  conversationId: string,
  read: ReadBranchWork,
): Promise<BranchRecord> {
  const tree = await primaryChatWorktree(db, conversationId);
  if (!tree?.ownsBranch) return NOT_KNOWN;
  try {
    const work = await read(tree.path, tree.branch, tree.baseCommit);
    return { committed: work.commits && !work.uncommitted, pushed: work.commits && work.pushed };
  } catch {
    return NOT_KNOWN;
  }
}

export async function reportFacts(
  db: Queryable,
  row: Pick<SubChatRow, 'id' | 'status' | 'branch' | 'pullRequest'>,
  read: ReadBranchWork = branchWork,
): Promise<ReportFacts> {
  return {
    status: row.status,
    branch: row.branch,
    pullRequest: row.pullRequest,
    ...(await branchRecord(db, row.id, read)),
  };
}
