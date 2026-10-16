import { commandKey, type RunMode } from '@spark-outpost/contracts';
import { repoScanner } from '../agent-config/discovery.ts';
import { loadRepoLaunch } from '../agent-config/launch.ts';
import { conversationProjectIds } from '../agent-config/store.ts';
import { loadUserMcp } from '../mcp/launch.ts';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import type { Lease } from '../persistence/jobs.ts';
import type { ContextReading, ProviderSessionRecord } from '../persistence/provider-sessions.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import type { PermissionGate, ProviderTurn } from '../providers/provider.ts';
import type { ProtocolEntry } from '../audit/protocol-entry.ts';
import type { Append, TurnDeps } from '../workflow/agent-turn.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { createAuditRecorder } from '../workflow/audit-recorder.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { readingOf } from './policy.ts';

export const COMPACT_COMMAND = 'compact';

export interface CompactTarget {
  session: ProviderSessionRecord;
  mode: RunMode | null;
  commands: readonly string[];
  model: string | null;
  effort: string | null;
}

export interface AgentCompaction {
  after: ContextReading | null;
  text: string;
}

const REFUSE_ALL: PermissionGate = {
  review: async () => ({ outcome: 'cancelled', note: 'Compacting makes no changes' }),
};

export function offersCompact(commands: readonly string[]): boolean {
  return commands.some((name) => commandKey(name) === COMPACT_COMMAND);
}

function gated(mode: RunMode | null, roots: readonly string[]): boolean {
  return mode === 'do' || (mode === 'ask' && roots.length > 0);
}

async function launchExtras(deps: TurnDeps, input: RunInput) {
  const conversationId = input.identity.threadId;
  const repo = await loadRepoLaunch(deps.db, repoScanner, conversationId, input.projectRoots).catch(
    () => [],
  );
  const userMcp = await loadUserMcp(
    deps.db,
    conversationId,
    await conversationProjectIds(deps.db, conversationId),
  ).catch(() => []);
  return { repo, userMcp, spark: await sparkPreferences(deps.db, input.workspaceId) };
}

export interface RunLog {
  runId: string;
  write(entries: ProtocolEntry[]): Promise<void>;
}

export function leaseLog(deps: Pick<TurnDeps, 'db'>, lease: Lease): RunLog {
  return {
    runId: lease.runId,
    write: (entries) => insertProtocolEntries(deps.db, lease, entries),
  };
}

export async function compactInSession(
  deps: TurnDeps,
  log: RunLog,
  input: RunInput,
  target: CompactTarget,
  append: Append,
  signal: AbortSignal,
): Promise<AgentCompaction | null> {
  const provider = deps.providers.get(target.session.provider);
  if (!provider) return null;
  const extras = await launchExtras(deps, input);
  const audit = createAuditRecorder({ write: (entries) => log.write(entries) });
  const own = new AbortController();
  const stop = () => own.abort();
  signal.addEventListener('abort', stop, { once: true });
  const { session } = target;
  const turn: ProviderTurn = {
    prompt: `/${COMPACT_COMMAND}`,
    history: [],
    settings: { ...input.settings, model: target.model, effort: target.effort },
    projectRoots: input.projectRoots,
    signal: own.signal,
    audit,
    ...(target.mode ? { mode: target.mode } : {}),
    ...(gated(target.mode, input.projectRoots) ? { approvals: REFUSE_ALL } : {}),
    session: {
      workdir: session.workdir,
      resume: {
        sessionId: session.sessionId,
        cwd: session.cwd,
        additionalDirectories: session.additionalDirs,
        commands: [...target.commands],
      },
      freshReason: null,
      followUp: `/${COMPACT_COMMAND}`,
    },
    ...(extras.repo.length > 0 ? { repo: extras.repo } : {}),
    ...(extras.userMcp.length > 0 ? { userMcp: extras.userMcp } : {}),
    spark: extras.spark,
    sparkScope: {
      workspaceId: input.workspaceId,
      conversationId: input.identity.threadId,
      runId: log.runId,
      actions: {
        append,
        waiters: deps.approvalWaiters ?? new ApprovalWaiters(),
        signal: own.signal,
        timeoutMs: deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
        pollMs: deps.approvalPollMs ?? APPROVAL_POLL_MS,
        audit,
      },
    },
  };
  let after: ContextReading | null = null;
  let text = '';
  let resumed = true;
  try {
    for await (const output of provider.run(turn)) {
      if (output.kind === 'session' && !output.continued) {
        resumed = false;
        own.abort();
      }
      if (output.kind === 'usage') {
        after = readingOf(output.contextUsed, output.contextSize) ?? after;
      }
      if (output.kind === 'text_delta') text += output.delta;
    }
  } catch (error) {
    if (resumed && !signal.aborted) console.error('The agent could not compact its session', error);
  } finally {
    signal.removeEventListener('abort', stop);
    await audit.close().catch(() => audit.discard());
  }
  if (!resumed || signal.aborted) return null;
  return { after, text: text.trim() };
}
