import {
  checkCause,
  failingChecks,
  type CheckBody,
  type CheckResult,
} from '@spark-outpost/contracts';
import { CHECK_FIXES } from '../advisor/policy.ts';
import { failureSignature } from '../checks/failures.ts';
import { checkFailureText } from './context.ts';
import type { CheckMemory, Session } from './session.ts';

export function checkMemory(s: Session): CheckMemory {
  s.checkMemory ??= { unfinished: new Set(), fixed: new Set(), fixRounds: new Map() };
  return s.checkMemory;
}

function signatureOf(body: CheckBody): string {
  return failingChecks(body)
    .map((result) =>
      failureSignature(
        result.scope?.whole ?? result.command,
        result.failures ?? [],
        result.exitCode,
      ),
    )
    .join('\n');
}

export function startsCheckFix(s: Session, body: CheckBody | null): body is CheckBody {
  if (body?.status !== 'failed') return false;
  const memory = checkMemory(s);
  const who = `${body.name}:${body.copy ?? ''}`;
  const signature = `${who}\n${signatureOf(body)}`;
  const rounds = memory.fixRounds.get(who) ?? 0;
  if (rounds >= CHECK_FIXES || memory.fixed.has(signature)) return false;
  memory.fixed.add(signature);
  memory.fixRounds.set(who, rounds + 1);
  return true;
}

export function changeFailureText(body: CheckBody): string {
  const failing = failingChecks(body);
  const before = failing.flatMap((result) => result.baseline?.shared ?? []);
  const text = checkFailureText(failing);
  if (before.length === 0) return text;
  return `${text}\n\nThese already failed before your change; leave them alone: ${before.join(', ')}.`;
}

export function latestChecks(bodies: readonly CheckBody[]): CheckBody[] {
  const latest = new Map<string, CheckBody>();
  for (const body of bodies) latest.set(`${body.name}:${body.copy ?? ''}`, body);
  return [...latest.values()];
}

export function checksFailing(s: Session): boolean {
  return latestChecks(s.checkBodies).some((body) => body.status === 'failed');
}

function resultStatus(result: CheckResult): string {
  const cause = checkCause(result);
  if (result.outcome === 'passed') {
    return result.scope ? `passed for ${result.scope.label} only` : 'passed';
  }
  if (cause === 'baseline') return 'fails the same way before this change (not caused by it)';
  if (cause === 'timeout') return 'could not finish in time (says nothing about this change)';
  if (cause === 'environment') return `could not run: ${result.note ?? 'setup problem'}`;
  if (cause === 'change') return `failed (exit ${result.exitCode ?? '?'})`;
  return result.outcome.replace('_', ' ');
}

export function checkLines(body: CheckBody | null): string[] {
  if (!body) return [];
  const lines = body.results.map((result) => `- \`${result.command}\` ${resultStatus(result)}`);
  const failing = failingChecks(body);
  if (failing.length > 0) lines.push('', checkFailureText(failing));
  return lines;
}
