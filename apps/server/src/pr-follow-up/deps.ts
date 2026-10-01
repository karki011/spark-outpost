import type { IntakeDeps } from '../advisor/intake-recorder.ts';
import { resolveRunTarget } from '../api/run-target.ts';
import { sendUserMessage } from '../persistence/conversations.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import type { Watch } from '../persistence/pr-watches.ts';
import { connectionFor, type GitHubDeps } from '../ship/github/access.ts';
import type { GitHubConnection } from '../ship/github/connection.ts';
import type { ShipDeps } from '../ship/prepare.ts';

export interface FollowUpDeps {
  db: Db;
  github: Omit<GitHubDeps, 'db' | 'workspaceId'>;
  branchPrefix: string;
  jev?: IntakeDeps | null;
  connect?: (workspaceId: string, host: string) => Promise<GitHubConnection | null>;
  startRound?: (watch: Watch, content: string) => Promise<string>;
  now?: () => Date;
  signal?: AbortSignal;
}

export function shipDepsOf(deps: FollowUpDeps, workspaceId: string): ShipDeps {
  return { ...deps.github, db: deps.db, workspaceId, branchPrefix: deps.branchPrefix };
}

export function connectTo(deps: FollowUpDeps, watch: Watch): Promise<GitHubConnection | null> {
  if (deps.connect) return deps.connect(watch.workspaceId, watch.host);
  return connectionFor({ ...deps.github, db: deps.db, workspaceId: watch.workspaceId }, watch.host);
}

export const nowOf = (deps: FollowUpDeps) => deps.now?.() ?? new Date();

export async function sendRoundMessage(db: Db, watch: Watch, content: string): Promise<string> {
  const target = await resolveRunTarget(
    { db, workspaceId: watch.workspaceId },
    watch.conversationId,
  );
  const level = target.level === 'full-auto' ? 'hands-off' : (target.level ?? null);
  const sent = await sendUserMessage(
    db,
    watch.conversationId,
    { id: newId(), content, source: 'pr_follow_up', startAs: 'change' },
    { ...target, level },
  );
  return sent.run.id;
}

export function startRoundRun(deps: FollowUpDeps, watch: Watch, content: string) {
  return deps.startRound
    ? deps.startRound(watch, content)
    : sendRoundMessage(deps.db, watch, content);
}
