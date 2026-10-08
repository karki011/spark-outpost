import { modePosture } from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { reachesHosting } from '../approvals/git-commands.ts';
import {
  publishBasis,
  publishRequested,
  type FollowUpRound,
  type PublishBasis,
  type PublishBrief,
  type PublishContext,
  type PublishGrant,
  type TaskBranch,
} from '../approvals/publish-policy.ts';
import type { Queryable } from '../persistence/db.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import { watchesForConversation } from '../persistence/pr-watches.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import { mainAgentPublishNote } from '../orchestration/context.ts';
import type { PublishScope } from '../ship/agent-push.ts';
import type { RunInput } from './run-input.ts';

const ALWAYS_PROTECTED = ['main', 'master'];

export async function taskBranch(db: Queryable, root: string | null): Promise<TaskBranch | null> {
  if (!root) return null;
  const record = await chatWorktreeAt(db, root);
  if (!record?.ownsBranch) return null;
  const fallback = await defaultBranch(record.repoRoot).catch(() => null);
  const named = [...ALWAYS_PROTECTED, record.baseBranch, fallback].filter(
    (branch): branch is string => Boolean(branch),
  );
  const pull = await openPullNumber(db, record.conversationId, record.branch).catch(() => null);
  return { branch: record.branch, protectedBranches: [...new Set(named)], pull };
}

async function openPullNumber(
  db: Queryable,
  conversationId: string | null,
  branch: string,
): Promise<number | null> {
  if (!conversationId) return null;
  const { rows } = await db.query<{ number: number }>(
    `SELECT number FROM pr_watches
     WHERE conversation_id = $1 AND branch = $2 AND pr_state = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId, branch],
  );
  return rows[0]?.number ?? null;
}

async function followsOwnPull(
  db: Queryable,
  round: FollowUpRound,
  task: TaskBranch | null,
): Promise<boolean> {
  if (!task) return false;
  const watches = await watchesForConversation(db, round.workspaceId, round.conversationId);
  return watches.some((watch) => watch.prState === 'open' && watch.branch === task.branch);
}

async function effectiveGrant(
  db: Queryable,
  grant: PublishGrant,
  task: TaskBranch | null,
): Promise<PublishGrant> {
  if (!grant.followUp || (await followsOwnPull(db, grant.followUp, task))) return grant;
  return { ...grant, followUp: null };
}

export async function publishContext(
  db: Queryable,
  grant: PublishGrant | undefined,
  request: ApprovalRequest,
): Promise<{ publish?: PublishContext }> {
  if (!grant || !request.command || !reachesHosting(request.command)) return {};
  const task = await taskBranch(db, request.roots[0]?.path ?? null).catch(() => null);
  return { publish: { grant: await effectiveGrant(db, grant, task), task } };
}

type GrantFacts = Pick<RunInput, 'level' | 'userRequest' | 'followUpRound' | 'workspaceId'> & {
  identity: Pick<RunInput['identity'], 'threadId'>;
};

export function publishGrant(input: GrantFacts): PublishGrant {
  const followUp = input.followUpRound
    ? { workspaceId: input.workspaceId, conversationId: input.identity.threadId }
    : null;
  return { level: input.level, requested: publishRequested(input.userRequest), followUp };
}

type StartFacts = GrantFacts & Pick<RunInput, 'provider' | 'agentMode' | 'piece'>;

export function startBasis(input: StartFacts): PublishBasis | null {
  if (input.piece?.coordinated) return null;
  return publishBasis(modePosture(input.provider, input.agentMode), publishGrant(input));
}

type NoteFacts = StartFacts & Pick<RunInput, 'projectRoots' | 'role' | 'mode' | 'preamble'>;

export async function withPublishNote(db: Queryable, input: NoteFacts): Promise<string | null> {
  const own = input.preamble ?? null;
  if (input.role !== null || input.mode !== 'do') return own;
  const brief = await publishBrief(db, input);
  if (brief?.basis !== 'requested') return own;
  return [own, mainAgentPublishNote(brief.branch)].filter(Boolean).join('\n\n');
}

export async function publishScope(
  db: Queryable,
  input: StartFacts & Pick<RunInput, 'projectRoots'>,
): Promise<PublishScope | null> {
  if (input.piece?.coordinated) return null;
  const root = input.projectRoots[0] ?? null;
  const task = await taskBranch(db, root).catch(() => null);
  if (!root || !task) return null;
  const grant = await effectiveGrant(db, publishGrant(input), task);
  const basis = publishBasis(modePosture(input.provider, input.agentMode), grant);
  return basis ? { basis, task, root } : null;
}

export async function publishBrief(
  db: Queryable,
  input: StartFacts & Pick<RunInput, 'projectRoots'>,
): Promise<PublishBrief | null> {
  const scope = await publishScope(db, input);
  return scope ? { basis: scope.basis, branch: scope.task.branch } : null;
}
