import type { IntakeDeps } from '../advisor/jev-types.ts';
import { resolveRunTarget } from '../api/run-target.ts';
import { sendInTransaction, type RunTarget } from '../persistence/conversations.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
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

export function connectTo(
  deps: FollowUpDeps,
  watch: Pick<Watch, 'workspaceId' | 'host' | 'owner' | 'repo'>,
): Promise<GitHubConnection | null> {
  if (deps.connect) return deps.connect(watch.workspaceId, watch.host);
  return connectionFor(
    { ...deps.github, db: deps.db, workspaceId: watch.workspaceId },
    { host: watch.host, owner: watch.owner, name: watch.repo },
  );
}

export const nowOf = (deps: FollowUpDeps) => deps.now?.() ?? new Date();

export function roundResumeKey(watchId: string): string {
  return `pr-follow-up:${watchId}`;
}

export async function startRoundWith(
  db: Db,
  watch: Pick<Watch, 'id' | 'conversationId'>,
  content: string,
  target: RunTarget,
): Promise<string> {
  return withTransaction(db, async (client) => {
    const sent = await sendInTransaction(
      client,
      watch.conversationId,
      { id: newId(), content, source: 'pr_follow_up', startAs: 'change' },
      target,
    );
    await client.query('UPDATE runs SET route = $2 WHERE id = $1', [
      sent.run.id,
      JSON.stringify({ resumeKey: roundResumeKey(watch.id) }),
    ]);
    return sent.run.id;
  });
}

export async function sendRoundMessage(db: Db, watch: Watch, content: string): Promise<string> {
  const target = await resolveRunTarget(
    { db, workspaceId: watch.workspaceId },
    watch.conversationId,
  );
  const level = target.level === 'full-auto' ? 'hands-off' : (target.level ?? null);
  return startRoundWith(db, watch, content, { ...target, level });
}

export function startRoundRun(deps: FollowUpDeps, watch: Watch, content: string) {
  return deps.startRound
    ? deps.startRound(watch, content)
    : sendRoundMessage(deps.db, watch, content);
}
