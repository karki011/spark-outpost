import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CHECK_TOOL_CALL_PREFIX,
  type CheckBody,
  type CheckResult,
  type CheckStatus,
} from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import type { CheckCommand } from '../checks/detect.ts';
import { runsPackageScript, scriptsFingerprint } from '../checks/project-checks.ts';
import { runCheck, type CheckRun } from '../checks/run-check.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { nextArtifactVersion } from '../persistence/artifacts.ts';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import { createApprovalGate } from '../workflow/approval-gate.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { runEvents } from '../workflow/run-events.ts';
import { CheckpointTimeout } from './checkpoint.ts';
import { publish, type Session } from './session.ts';

export const SCRIPTS_CHANGED_NOTE =
  'The package.json scripts changed during this run, so this check was not run automatically.';

export interface CheckTarget {
  runId: string;
  name: string;
  cwd: string;
  copy: string | null;
}

function checkRequest(check: CheckCommand, target: CheckTarget, root: string): ApprovalRequest {
  return {
    toolCallId: `${CHECK_TOOL_CALL_PREFIX}${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: `Run check: ${check.command}`,
    command: check.command,
    cwd: target.cwd,
    paths: [],
    diffs: [],
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
    ],
    roots: [{ path: root, ignore: [] }],
    home: homedir(),
  };
}

async function approvalIdFor(s: Session, toolCallId: string): Promise<string | null> {
  const { rows } = await s.deps.db.query<{ id: string }>(
    'SELECT id FROM approvals WHERE run_id = $1 AND tool_call_id = $2 ORDER BY created_at DESC LIMIT 1',
    [s.lease.runId, toolCallId],
  );
  return rows[0]?.id ?? null;
}

function resultOf(check: CheckCommand, run: CheckRun, approvalId: string | null): CheckResult {
  const outcome = run.timedOut ? 'timed_out' : run.exitCode === 0 ? 'passed' : 'failed';
  return {
    command: check.command,
    kind: check.kind,
    outcome,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    outputTail: run.outputTail,
    truncated: run.truncated,
    note: null,
    approvalId,
  };
}

function notRun(
  check: CheckCommand,
  outcome: 'skipped' | 'denied',
  note: string,
  approvalId: string | null = null,
): CheckResult {
  return {
    command: check.command,
    kind: check.kind,
    outcome,
    exitCode: null,
    durationMs: 0,
    outputTail: '',
    truncated: false,
    note,
    approvalId,
  };
}

export function checkStatus(results: readonly CheckResult[]): CheckStatus {
  if (results.some((result) => result.outcome === 'failed' || result.outcome === 'timed_out')) {
    return 'failed';
  }
  return results.some((result) => result.outcome === 'passed') ? 'passed' : 'skipped';
}

function relativeCwd(root: string, cwd: string): string {
  return path.relative(root, cwd) || '.';
}

async function audit(s: Session, target: CheckTarget, result: CheckResult, root: string) {
  const payload = redactValue({
    command: result.command,
    cwd: relativeCwd(root, target.cwd),
    copy: target.copy,
    builderRunId: target.runId,
    outcome: result.outcome,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    note: result.note,
    outputTail: result.outputTail,
  });
  await insertProtocolEntries(s.deps.db, s.lease, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'check',
      method: 'check/run',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: result.truncated,
      payload,
    },
  ]);
}

const recordQueues = new Map<string, Promise<void>>();

export function queueRecord(taskId: string, write: () => Promise<void>): Promise<void> {
  const next = (recordQueues.get(taskId) ?? Promise.resolve()).then(write);
  const settled = next.catch(() => undefined);
  recordQueues.set(taskId, settled);
  void settled.then(() => {
    if (recordQueues.get(taskId) === settled) recordQueues.delete(taskId);
  });
  return next;
}

async function record(s: Session, body: CheckBody): Promise<void> {
  const taskId = s.taskId;
  if (!taskId) return;
  await queueRecord(taskId, async () => {
    const version = await nextArtifactVersion(s.deps.db, taskId, 'check');
    await s.append(runEvents.activity('artifact:check', 'check', { version, body }), {
      artifact: {
        taskId,
        kind: 'check',
        body,
        version,
        overwrite: false,
        supersedesPrevious: false,
      },
    });
  });
}

function checkGate(s: Session, target: CheckTarget, timedOut: () => void) {
  return createApprovalGate({
    db: s.deps.db,
    runId: s.lease.runId,
    level: s.input.level,
    append: s.append,
    waiters: s.deps.approvalWaiters ?? new ApprovalWaiters(),
    ...(s.deps.approvalPollMs === undefined ? {} : { pollMs: s.deps.approvalPollMs }),
    ...(s.deps.approvalTimeoutMs === undefined ? {} : { timeoutMs: s.deps.approvalTimeoutMs }),
    onTimeout: timedOut,
    backup: async () => undefined,
    copyOf: target.copy,
  });
}

async function runOne(
  s: Session,
  check: CheckCommand,
  target: CheckTarget,
  root: string,
): Promise<CheckResult | null> {
  const scripts = s.checks?.scripts ?? '';
  if (runsPackageScript(check) && (await scriptsFingerprint(target.cwd)) !== scripts) {
    return notRun(check, 'skipped', SCRIPTS_CHANGED_NOTE);
  }
  let timedOut = false;
  const request = checkRequest(check, target, root);
  const answer = await checkGate(s, target, () => (timedOut = true)).review(
    request,
    s.control.signal,
  );
  if (timedOut) throw new CheckpointTimeout();
  const approvalId = await approvalIdFor(s, request.toolCallId);
  if (answer.outcome === 'cancelled' && s.control.signal.aborted) return null;
  if (answer.outcome !== 'selected' || !answer.allowed) {
    return notRun(check, 'denied', answer.note ?? 'Not allowed.', approvalId);
  }
  const run = await runCheck(check, { root, cwd: target.cwd, signal: s.control.signal });
  if (run.cancelled) return null;
  return resultOf(check, run, approvalId);
}

export async function runChecks(s: Session, target: CheckTarget): Promise<CheckBody | null> {
  const root = s.input.projectRoots[0];
  if (!s.checks || !root) return null;
  s.checkRounds += 1;
  const round = s.checkRounds;
  const results: CheckResult[] = [];
  for (const check of s.checks.commands) {
    const result = await runOne(s, check, target, root);
    if (!result) return null;
    results.push(result);
    await audit(s, target, result, root);
  }
  const body: CheckBody = {
    runId: target.runId,
    name: target.name,
    copy: target.copy,
    round,
    status: checkStatus(results),
    results,
  };
  s.checkBodies.push(body);
  await record(s, body);
  await publish(s);
  return body;
}
