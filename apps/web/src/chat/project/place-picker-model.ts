import type { ChatWorkspace, ProjectBranches } from '@spark-outpost/contracts';

export interface BranchRow {
  name: string;
  remote: boolean;
  tags: string[];
}

const ROWS_SHOWN = 50;

export function placeLabel(workspace: ChatWorkspace, checkoutBranch: string | null): string {
  if (workspace.requestedBranch) return `${workspace.requestedBranch} · copy`;
  if (workspace.place === 'checkout') return `${checkoutBranch ?? 'Your branch'} · my files`;
  return 'New branch · copy';
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
