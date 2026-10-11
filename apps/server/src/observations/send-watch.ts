import { homedir } from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import { approvalRequestFrom } from '../agents/acp/permission-request.ts';
import { objectFields } from '../agents/acp/object-fields.ts';
import { sparkReserved } from '../agents/acp/spark-tools.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { diskFiles } from '../approvals/file-lister.ts';
import { isGitPush } from '../approvals/git-commands.ts';
import { withPrefetchedFiles } from '../approvals/prefetched-files.ts';
import { otherBranchPushes } from '../approvals/publish-policy.ts';
import { observedSecretReads } from '../approvals/secret-reads.ts';
import { parseShell } from '../approvals/shell-parse.ts';
import { sentOut } from '../approvals/taint.ts';
import {
  createReviewTracker,
  permissionToolCallId,
  sessionUpdateOf,
} from '../audit/review-tracker.ts';
import type { Queryable } from '../persistence/db.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import { subject } from '../workflow/approval-payload.ts';
import { taskBranch } from '../workflow/publish-context.ts';
import { ownRepoFor } from '../workflow/send-context.ts';
import { raiseRailFlag } from './raise-flag.ts';
import type { RunObservations } from './run-observations.ts';
import { observedStackedPush } from './stacked-push-watch.ts';

export interface SendWatchOptions {
  db: Queryable;
  runId: string;
  mode: string | null | undefined;
  projectRoots: readonly string[];
  observations: RunObservations;
  home?: string;
}

const TOOL_FIELDS = ['title', 'kind', 'rawInput', 'locations', '_meta'] as const;

function merged(previous: acp.ToolCallUpdate | undefined, update: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...previous, toolCallId: update.toolCallId };
  for (const field of TOOL_FIELDS) {
    if (update[field] !== undefined && update[field] !== null) next[field] = update[field];
  }
  return next as unknown as acp.ToolCallUpdate;
}

export function watchedSends(inner: ProtocolObserver, options: SendWatchOptions): ProtocolObserver {
  const cwd = options.projectRoots[0];
  if (!cwd || options.mode !== 'do') return inner;
  const roots = options.projectRoots.map((root) => ({ path: root, ignore: [] }));
  const home = options.home ?? homedir();
  const review = createReviewTracker();
  const calls = new Map<string, acp.ToolCallUpdate>();
  const asked = new Set<string>();

  const note = async (request: ApprovalRequest) => {
    if (request.mcpServer && sparkReserved([]).includes(request.mcpServer)) return;
    const observed = await options.observations.labels();
    if (observed.length === 0) return;
    const own = await ownRepoFor(options.db, options.runId, request);
    const sent = await withPrefetchedFiles(
      diskFiles,
      (files) => sentOut(request, files, { observed, own }),
      null,
    );
    if (!sent) return;
    options.observations.sentOut({
      toolCallId: request.toolCallId,
      subject: subject(request),
      ...sent,
    });
  };

  const pushedElsewhere = async (request: ApprovalRequest) => {
    if (!request.command || !isGitPush(request.command)) return;
    const task = await taskBranch(options.db, cwd);
    const branches = otherBranchPushes(request.command, task);
    if (!branches) return;
    await raiseRailFlag(options.db, options.runId, inner, {
      toolCallId: request.toolCallId,
      rail: 'other_push',
      paths: branches,
      inside: false,
      originals: [],
    });
  };

  const readThenSent = async (request: ApprovalRequest, ran: boolean) => {
    const shell = request.kind === 'execute' ? await parseShell(request.command) : null;
    for (const label of await observedSecretReads(request, shell)) {
      options.observations.record({ source: 'secret_file', label });
    }
    if (!ran) return;
    const stacked = await observedStackedPush(options.db, request);
    if (stacked) await options.observations.crossed(stacked);
    await note(request);
    await pushedElsewhere(request);
  };

  const watch = (message: unknown) => {
    const permission = permissionToolCallId(message);
    if (permission) {
      asked.add(permission);
      review.asked(permission);
    }
    const update = objectFields(sessionUpdateOf(message));
    const id = update.toolCallId;
    if (typeof id !== 'string') return;
    calls.set(id, merged(calls.get(id), update));
    const ran = review.settle(update) !== null;
    if (!ran && (update.status !== 'completed' || asked.has(id))) return;
    const toolCall = calls.get(id)!;
    calls.delete(id);
    const request = approvalRequestFrom(
      { sessionId: '', toolCall, options: [] },
      { rpcId: null, roots, cwd, home },
    );
    options.observations.later(() => readThenSent(request, ran));
  };

  return {
    message(direction, message) {
      inner.message(direction, message);
      if (direction !== 'from_agent') return;
      try {
        watch(message);
      } catch (error) {
        console.error('Could not watch a send', error);
      }
    },
    stderr: (chunk) => inner.stderr(chunk),
  };
}
