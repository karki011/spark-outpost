import { modePosture } from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { publishesCode } from '../approvals/git-commands.ts';
import {
  publishBasis,
  publishRequested,
  type PublishBasis,
  type PublishBrief,
  type PublishContext,
  type PublishGrant,
  type TaskBranch,
} from '../approvals/publish-policy.ts';
import type { Queryable } from '../persistence/db.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
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
  return { branch: record.branch, protectedBranches: [...new Set(named)] };
}

export async function publishContext(
  db: Queryable,
  grant: PublishGrant | undefined,
  request: ApprovalRequest,
): Promise<{ publish?: PublishContext }> {
  if (!grant || !request.command || !publishesCode(request.command)) return {};
  const task = await taskBranch(db, request.roots[0]?.path ?? null).catch(() => null);
  return { publish: { grant, task } };
}

export function publishGrant(input: Pick<RunInput, 'level' | 'userRequest'>): PublishGrant {
  return { level: input.level, requested: publishRequested(input.userRequest) };
}

type StartFacts = Pick<RunInput, 'level' | 'userRequest' | 'provider' | 'agentMode' | 'piece'>;

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

export async function publishBrief(
  db: Queryable,
  input: StartFacts & Pick<RunInput, 'projectRoots'>,
): Promise<PublishBrief | null> {
  const basis = startBasis(input);
  if (!basis) return null;
  const task = await taskBranch(db, input.projectRoots[0] ?? null).catch(() => null);
  return task ? { basis, branch: task.branch } : null;
}

export async function publishScope(
  db: Queryable,
  input: StartFacts & Pick<RunInput, 'projectRoots'>,
): Promise<PublishScope | null> {
  const basis = startBasis(input);
  const root = input.projectRoots[0] ?? null;
  if (!basis || !root) return null;
  const task = await taskBranch(db, root).catch(() => null);
  return task ? { basis, task, root } : null;
}
