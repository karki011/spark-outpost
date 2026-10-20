import type {
  AdoptedPull,
  ChatBranch,
  ChatWorkspace,
  ProjectBranches,
} from '@spark-outpost/contracts';
import { relativeTime } from '../../ui/relative-time.ts';

export interface BranchRow {
  name: string;
  remote: boolean;
  tags: string[];
}

const ROWS_SHOWN = 50;

export function placeLabel(workspace: ChatWorkspace, checkoutBranch: string | null): string {
  if (workspace.requestedBranch) return workspace.requestedBranch;
  if (workspace.place === 'checkout') return `${checkoutBranch ?? 'Your branch'} · my files`;
  return 'New branch';
}

export function branchRows(
  branches: ProjectBranches,
  query: string,
  checkoutBranch: string | null,
): BranchRow[] {
  const needle = query.trim().toLowerCase();
  const rows: BranchRow[] = [
    ...branches.local.map((name) => ({
      name,
      remote: false,
      tags: name === checkoutBranch ? ['in my files'] : [],
    })),
    ...branches.remote.map((name) => ({ name, remote: true, tags: ['remote'] })),
  ];
  const current = rows.filter((row) => row.name === checkoutBranch);
  const rest = rows.filter((row) => row.name !== checkoutBranch);
  return [...current, ...rest]
    .filter((row) => !needle || row.name.toLowerCase().includes(needle))
    .slice(0, ROWS_SHOWN);
}

export function adoptedLabel(adopted: AdoptedPull): string {
  const pull = `PR #${adopted.number} by @${adopted.author}`;
  return adopted.pushes ? pull : `based on ${pull}`;
}

export function branchTip(branch: ChatBranch, now: number = Date.now()): string {
  if (!branch.baseRef) return branch.branch;
  const when = branch.createdAt ? ` · ${relativeTime(branch.createdAt, now)}` : '';
  return `${branch.branch} · from ${branch.baseRef}${when}`;
}
