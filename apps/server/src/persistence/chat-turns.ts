export const FOLLOW_UP_SOURCE = 'pr_follow_up';

export function chatTurn(alias?: string): string {
  const column = (name: string) => (alias ? `${alias}.${name}` : name);
  return `${column('parent_run_id')} IS NULL AND ${column('source')} IS DISTINCT FROM '${FOLLOW_UP_SOURCE}'`;
}

export function notFollowUp(alias: string): string {
  return `${alias}.source IS DISTINCT FROM '${FOLLOW_UP_SOURCE}'`;
}
