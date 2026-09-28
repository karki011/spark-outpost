const SLUG_MAX = 40;
const ID_LENGTH = 8;

export function taskSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= SLUG_MAX) return slug || 'task';
  const cut = slug.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > SLUG_MAX / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

export function shipBranchName(prefix: string, title: string, taskId: string): string {
  return `${prefix}/${taskSlug(title)}-${taskId.replaceAll('-', '').slice(0, ID_LENGTH)}`;
}

export function isShipBranch(branch: string, prefix: string): boolean {
  return (
    branch.startsWith(`${prefix}/`) &&
    !branch.slice(prefix.length + 1).includes('/') &&
    /^[a-z0-9][a-z0-9/-]*[a-z0-9]$/.test(branch) &&
    !branch.includes('//')
  );
}

export function safeToPush(
  branch: string,
  prefix: string,
  protectedBranches: readonly (string | null)[],
): boolean {
  return isShipBranch(branch, prefix) && !protectedBranches.includes(branch);
}
