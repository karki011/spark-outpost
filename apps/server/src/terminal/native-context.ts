import { modePosture } from '@spark-outpost/contracts';
import { createRunObservations } from '../observations/run-observations.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { appendNativeRun, type NativeFence } from '../persistence/native-terminal-turns.ts';
import type { SparkScope } from '../spark-mcp/deps.ts';
import { SparkToolError } from '../spark-mcp/tool.ts';
import type { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { createAuditRecorder } from '../workflow/audit-recorder.ts';
import { publishScope } from '../workflow/publish-context.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { NativeHookEvent, NativeProvider } from './native-hooks.ts';

export function observedNativeMode(
  provider: NativeProvider,
  event: NativeHookEvent,
): string | null {
  const mode = event.permissionMode;
  if (!mode) return null;
  if (provider === 'claude') {
    if (mode === 'manual') return 'default';
    return ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'].includes(mode)
      ? mode
      : null;
  }
  if (mode === 'plan') return 'read-only';
  if (mode === 'bypassPermissions') return 'agent-full-access';
  if (mode === 'default' || mode === 'acceptEdits' || mode === 'dontAsk') return 'ask-every-action';
  return null;
}

export function boundedNativeMode(
  provider: NativeProvider,
  ceiling: string,
  observed: string | null,
): string | null {
  if (observed === null) return null;
  const rank = { unknown: 0, read_only: 0, denies: 1, asks: 1, edits: 2, auto: 3, full_access: 4 };
  const selectedMode = provider === 'claude' && ceiling === 'manual' ? 'default' : ceiling;
  const selected = modePosture(provider, selectedMode);
  const reported = modePosture(provider, observed);
  return rank[reported] < rank[selected] ? observed : selectedMode;
}

export function nativeActivity(event: NativeHookEvent, active: boolean) {
  const states = {
    session_start: active ? 'working' : 'ready',
    prompt: 'working',
    tool_start: 'working',
    tool_end: 'working',
    permission: 'waiting_for_permission',
    question: 'waiting_for_input',
    stop: 'ready',
    error: 'ready',
    session_end: 'exited',
    interrupt: 'ready',
  } as const;
  return states[event.kind];
}

export async function nativeTurnContext(
  db: Db,
  fence: NativeFence,
  input: RunInput,
  mode: string | null,
  waiters: ApprovalWaiters,
) {
  const runId = input.identity.runId;
  const controller = new AbortController();
  const audit = createAuditRecorder({
    write: (entries) => insertFinishedRunEntries(db, runId, entries),
  });
  const observations = createRunObservations({ db, runId, audit });
  const scope: SparkScope = {
    workspaceId: input.workspaceId,
    conversationId: input.identity.threadId,
    runId,
    readOnly: mode === null || modePosture(input.provider, mode) === 'read_only',
    observations,
    publish: mode ? await publishScope(db, { ...input, agentMode: mode }) : null,
    actions: {
      append: (event, options) => appendNativeRun(db, { ...fence, runId }, event, options),
      waiters,
      signal: controller.signal,
      timeoutMs: Infinity,
      pollMs: 500,
      audit,
    },
  };
  return {
    input,
    scope,
    controller,
    audit,
    observations,
    async mode(mode: string | null) {
      scope.readOnly = mode === null || modePosture(input.provider, mode) === 'read_only';
      scope.publish = mode ? await publishScope(db, { ...input, agentMode: mode }) : null;
      const effective = mode ?? (input.provider === 'claude' ? 'plan' : 'read-only');
      await db.query('UPDATE runs SET used_mode = $2 WHERE id = $1', [runId, effective]);
      audit.message('harness', {
        method: 'native/mode',
        params: {
          mode: effective,
          observed: mode !== null,
          posture: modePosture(input.provider, effective),
        },
      });
    },
    check() {
      if (controller.signal.aborted) throw new SparkToolError('This terminal turn has ended.');
    },
    async close() {
      controller.abort();
      await observations.settled();
      await audit.close();
    },
  };
}

export type NativeTurnContext = Awaited<ReturnType<typeof nativeTurnContext>>;
