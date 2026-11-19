import { section, type ChangedFile } from '../orchestration/context.ts';
import type { Queryable } from '../persistence/db.ts';
import { currentBranch } from '../projects/git.ts';

export const LIVE_STATE_HEADING = 'Live state, checked by Spark';

const FILES_SHOWN = 30;

export interface OwnPullRequest {
  number: number;
  url: string;
  state: string;
  draft: boolean;
  checks: string;
  polledAt: Date | null;
}

export interface LiveState {
  checkedAt: Date;
  branch: string | null;
  pulls: readonly OwnPullRequest[];
  changes: readonly ChangedFile[];
}

function minute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function pullLine(pull: OwnPullRequest): string {
  const draft = pull.draft ? ', draft' : '';
  const checks = pull.checks === 'none' ? 'no checks' : `checks ${pull.checks}`;
  const seen = pull.polledAt
    ? `GitHub last read ${minute(pull.polledAt)}`
    : 'not read from GitHub yet';
  return `Pull request #${pull.number} (${pull.state}${draft}, ${checks}; ${seen}): ${pull.url}`;
}

function changesLine(changes: readonly ChangedFile[]): string {
  const shown = changes
    .slice(0, FILES_SHOWN)
    .map((file) => `${file.path} (+${file.additions} -${file.deletions})`);
  const more = changes.length > FILES_SHOWN ? `, and ${changes.length - FILES_SHOWN} more` : '';
  return `Uncommitted changes: ${shown.join(', ')}${more}`;
}

export function liveStateText(state: LiveState): string {
  const lines = [
    ...(state.branch ? [`Branch: ${state.branch}`] : []),
    ...state.pulls.map(pullLine),
    ...(state.changes.length > 0 ? [changesLine(state.changes)] : []),
  ];
  if (lines.length === 0) return '';
  return section(
    `${LIVE_STATE_HEADING} at ${minute(state.checkedAt)}`,
    lines.map((line) => `- ${line}`).join('\n'),
  );
}

async function ownPullRequests(db: Queryable, conversationId: string): Promise<OwnPullRequest[]> {
  const { rows } = await db.query<{
    number: number;
    url: string;
    pr_state: string;
    draft: boolean;
    checks: string;
    last_polled_at: Date | null;
  }>(
    `SELECT number, url, pr_state, draft, checks, last_polled_at FROM pr_watches
     WHERE conversation_id = $1 AND pr_state = 'open' ORDER BY created_at DESC LIMIT 3`,
    [conversationId],
  );
  return rows.map((row) => ({
    number: row.number,
    url: row.url,
    state: row.pr_state,
    draft: row.draft,
    checks: row.checks,
    polledAt: row.last_polled_at,
  }));
}

export async function loadLiveState(
  db: Queryable,
  conversationId: string,
  root: string | null,
  changes: readonly ChangedFile[],
): Promise<string> {
  try {
    const [branch, pulls] = await Promise.all([
      root ? currentBranch(root) : Promise.resolve(null),
      ownPullRequests(db, conversationId),
    ]);
    return liveStateText({ checkedAt: new Date(), branch, pulls, changes });
  } catch (error) {
    console.error('Could not read the live state of the chat', error);
    return '';
  }
}
