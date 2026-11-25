export const FOLLOW_UP_SOURCE = 'pr_follow_up';
export const WORKFLOW_LANE = 'workflowLane';

function ownLane(column: (name: string) => string): string {
  return `(${column('source')} IS NOT DISTINCT FROM '${FOLLOW_UP_SOURCE}' OR COALESCE(${column('route')} ? '${WORKFLOW_LANE}', false))`;
}

export function chatTurn(alias?: string): string {
  const column = (name: string) => (alias ? `${alias}.${name}` : name);
  return `${column('parent_run_id')} IS NULL AND NOT ${ownLane(column)}`;
}

export function notFollowUp(alias: string): string {
  return `NOT ${ownLane((name) => `${alias}.${name}`)}`;
}
