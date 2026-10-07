import {
  checkBodySchema,
  checkCause,
  failingChecks,
  unrelatedFailures,
  unsettledChecks,
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

function fixSignature(body: CheckBody): string {
  return failingChecks(body)
    .map((result) => {
      const blamed = result.blamed ?? [];
      const ids = blamed.length > 0 ? blamed : (result.failures ?? []);
      return failureSignature(result.scope?.whole ?? result.command, ids, result.exitCode);
    })
    .join('\n');
}

const whoOf = (body: CheckBody): string => `${body.name}:${body.copy ?? ''}`;

async function earlierSignatures(s: Session): Promise<Set<string>> {
  const { rows } = await s.deps.db.query<{ body: unknown }>(
    `SELECT a.body FROM run_artifacts a
     WHERE a.kind = 'check' AND a.source_run_id = (
       SELECT earlier.source_run_id FROM run_artifacts earlier
       JOIN runs r ON r.id = earlier.source_run_id
       WHERE earlier.kind = 'check' AND r.conversation_id = $1 AND r.id <> $2
       ORDER BY earlier.created_at DESC LIMIT 1)`,
    [s.input.identity.threadId, s.lease.runId],
  );
  const found = new Set<string>();
  for (const row of rows) {
    const parsed = checkBodySchema.safeParse(row.body);
    if (parsed.success && parsed.data.status === 'failed') found.add(fixSignature(parsed.data));
  }
  return found;
}

export async function fixAlreadyTried(s: Session, body: CheckBody): Promise<boolean> {
  if (body.status !== 'failed') return false;
  const memory = checkMemory(s);
  memory.earlier ??= await earlierSignatures(s).catch(() => new Set<string>());
  const signature = fixSignature(body);
  return memory.fixed.has(`${whoOf(body)}\n${signature}`) || memory.earlier.has(signature);
}

export function startsCheckFix(s: Session, body: CheckBody | null): body is CheckBody {
  if (body?.status !== 'failed' || body.leftForUser) return false;
  const memory = checkMemory(s);
  const who = whoOf(body);
  const signature = `${who}\n${fixSignature(body)}`;
  const rounds = memory.fixRounds.get(who) ?? 0;
  if (rounds >= CHECK_FIXES || memory.fixed.has(signature)) return false;
  memory.fixed.add(signature);
  memory.fixRounds.set(who, rounds + 1);
  return true;
}

const NAMED_LIMIT = 10;

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMED_LIMIT).join(', ');
  return ids.length > NAMED_LIMIT ? `${shown} and ${ids.length - NAMED_LIMIT} more` : shown;
}

export function changeFailureText(body: CheckBody): string {
  const failing = failingChecks(body);
  const blamed = failing.flatMap((result) => result.blamed ?? []);
  const leave = failing.flatMap(unrelatedFailures);
  const parts = [checkFailureText(failing)];
  if (leave.length === 0) return parts[0]!;
  if (blamed.length > 0) parts.push(`Spark ties these to your change: ${named(blamed)}.`);
  parts.push(
    `These are not from your change (they fail without it, or in files it does not touch); leave them alone: ${named(leave)}.`,
  );
  return parts.join('\n\n');
}

export function latestChecks(bodies: readonly CheckBody[]): CheckBody[] {
  const latest = new Map<string, CheckBody>();
  for (const body of bodies) latest.set(`${body.name}:${body.copy ?? ''}`, body);
  return [...latest.values()];
}

export function checksFailing(s: Session): boolean {
  return latestChecks(s.checkBodies).some((body) => body.status === 'failed');
}

function namedFailures(result: CheckResult): string {
  const ids = result.failures ?? [];
  return ids.length > 0 ? `: ${named(ids)}` : '';
}

function resultStatus(result: CheckResult): string {
  const cause = checkCause(result);
  if (result.outcome === 'passed') {
    return result.scope ? `passed for ${result.scope.label} only` : 'passed';
  }
  if (cause === 'baseline') {
    return `fails the same way before this change (not caused by it)${namedFailures(result)}`;
  }
  if (cause === 'unknown') {
    return `fails, and nothing ties it to this change (not counted against it)${namedFailures(result)}`;
  }
  if (cause === 'timeout') return 'could not finish in time (says nothing about this change)';
  if (cause === 'environment') return `could not run: ${result.note ?? 'setup problem'}`;
  if (cause === 'change') return `failed (exit ${result.exitCode ?? '?'})`;
  return result.outcome.replace('_', ' ');
}

export const OUT_OF_SCOPE_RULE =
  'Checks above that are not caused by this change, not tied to it, or could not run are out of scope: do not report them as findings, and do not ask for changes to those tests or files.';

export function checkLines(body: CheckBody | null): string[] {
  if (!body) return [];
  const lines = body.results.map((result) => `- \`${result.command}\` ${resultStatus(result)}`);
  if (unsettledChecks(body).length > 0) lines.push('', OUT_OF_SCOPE_RULE);
  const failing = failingChecks(body);
  if (failing.length > 0) lines.push('', changeFailureText(body));
  return lines;
}

export interface UnrelatedNote {
  command: string;
  text: string;
}

function unrelatedNote(result: CheckResult): UnrelatedNote | null {
  const cause = checkCause(result);
  if (cause !== 'baseline' && cause !== 'unknown') return null;
  const ids = result.failures ?? [];
  const what = ids.length > 0 ? ` (${named(ids)})` : '';
  const text =
    cause === 'baseline'
      ? `\`${result.command}\` fails without this change as well${what}; this change did not cause it.`
      : `\`${result.command}\` fails${what} in files this change does not touch; Spark could not tell whether it also fails without the change.`;
  return { command: result.command, text };
}

export function unrelatedCheckNotes(s: Pick<Session, 'checkBodies'>): UnrelatedNote[] {
  const notes = latestChecks(s.checkBodies).flatMap((body) =>
    body.results.flatMap((result) => unrelatedNote(result) ?? []),
  );
  return [...new Map(notes.map((note) => [note.text, note])).values()];
}
