import { homedir } from 'node:os';
import path from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { RailKind, RailOriginal } from '@spark-outpost/contracts';
import type { ApprovalRequest, RequestRoot } from '../../approvals/decide.ts';
import { railCrossings, type RailCrossing } from '../../approvals/rail-crossings.ts';
import { observedSecretReads } from '../../approvals/secret-reads.ts';
import { outsideRoots } from '../../approvals/request-place.ts';
import { parseShell } from '../../approvals/shell-parse.ts';
import { createReviewTracker } from '../../audit/review-tracker.ts';
import type { AgentCli } from './agent-cli.ts';
import { stoppedByAgent } from './agent-stopped.ts';
import { approvalRequestFrom } from './permission-request.ts';
import { objectFields } from './object-fields.ts';

export interface ObservedRail {
  toolCallId: string;
  rail: RailKind;
  paths: string[];
  inside: boolean;
  originals: RailOriginal[];
  stopped: boolean;
}

export interface Observed {
  rails: ObservedRail[];
  secretReads: string[];
}

export interface RailWatch {
  asked(toolCallId: string): void;
  observe(update: unknown): Promise<Observed>;
}

const NOTHING: Observed = { rails: [], secretReads: [] };
const READ_KINDS = new Set(['read', 'search']);

export interface RailWatchContext {
  roots: readonly RequestRoot[];
  cwd: string;
  home?: string;
  cli?: AgentCli | null;
}

const ORIGINAL_MAX_CHARS = 64 * 1024;
const TOOL_FIELDS = ['title', 'kind', 'rawInput', 'locations', 'content', '_meta'] as const;

function shown(target: string, home: string): string {
  if (!path.isAbsolute(target)) return target;
  const relative = path.relative(home, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? `~/${relative}`
    : target;
}

function changesInside(crossing: RailCrossing, request: ApprovalRequest): boolean {
  if (crossing.rail === 'instructions') return true;
  if (crossing.rail !== 'secret' || request.kind !== 'edit') return false;
  return request.paths.every((target) => !outsideRoots(request, target));
}

function originalsOf(crossing: RailCrossing, request: ApprovalRequest, home: string) {
  const wanted = new Set(crossing.paths);
  return request.diffs.flatMap((diff): RailOriginal[] =>
    diff.oldText !== null && wanted.has(diff.path)
      ? [{ path: shown(diff.path, home), text: diff.oldText.slice(0, ORIGINAL_MAX_CHARS) }]
      : [],
  );
}

function merged(previous: acp.ToolCallUpdate | undefined, update: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...previous, toolCallId: update.toolCallId };
  for (const field of TOOL_FIELDS) {
    if (update[field] !== undefined && update[field] !== null) next[field] = update[field];
  }
  return next as unknown as acp.ToolCallUpdate;
}

export function createRailWatch(context: RailWatchContext): RailWatch {
  const home = context.home ?? homedir();
  const review = createReviewTracker();
  const calls = new Map<string, acp.ToolCallUpdate>();
  const asked = new Set<string>();
  const finishedRead = (id: unknown, status: unknown): string | null => {
    if (typeof id !== 'string' || status !== 'completed' || asked.has(id)) return null;
    return READ_KINDS.has(calls.get(id)?.kind ?? '') ? id : null;
  };
  return {
    asked(toolCallId) {
      asked.add(toolCallId);
      review.asked(toolCallId);
    },
    async observe(raw) {
      const update = objectFields(raw);
      const id = update.toolCallId;
      const kind = update.sessionUpdate;
      if (typeof id === 'string' && (kind === 'tool_call' || kind === 'tool_call_update')) {
        calls.set(id, merged(calls.get(id), update));
      }
      const ran = review.settle(raw);
      const settledId = ran?.toolCallId ?? finishedRead(id, update.status);
      const toolCall = settledId ? calls.get(settledId) : undefined;
      if (!settledId || !toolCall) return NOTHING;
      calls.delete(settledId);
      const request = approvalRequestFrom(
        { sessionId: '', toolCall, options: [] },
        { rpcId: null, roots: context.roots, cwd: context.cwd, home },
      );
      const shell = request.kind === 'execute' ? await parseShell(request.command) : null;
      const secretReads = await observedSecretReads(request, shell);
      if (!ran) return { rails: [], secretReads };
      const rails = (await railCrossings(request, { shell })).map((crossing) => ({
        toolCallId: ran.toolCallId,
        rail: crossing.rail,
        paths: crossing.paths.map((target) => shown(target, home)),
        inside: changesInside(crossing, request),
        originals: originalsOf(crossing, request, home),
        stopped: stoppedByAgent(
          context.cli ?? null,
          crossing.rail,
          toolCall,
          request.command,
          update.status === 'failed',
        ),
      }));
      return { rails, secretReads };
    },
  };
}
