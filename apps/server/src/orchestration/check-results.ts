import { failingChecks, type CheckBody, type CheckResult } from '@spark-outpost/contracts';
import { checkFailureText } from './context.ts';
import type { Session } from './session.ts';

export function latestChecks(bodies: readonly CheckBody[]): CheckBody[] {
  const latest = new Map<string, CheckBody>();
  for (const body of bodies) latest.set(`${body.name}:${body.copy ?? ''}`, body);
  return [...latest.values()];
}

export function checksFailing(s: Session): boolean {
  return latestChecks(s.checkBodies).some((body) => body.status === 'failed');
}

function resultStatus(result: CheckResult): string {
  if (result.outcome === 'passed') return 'passed';
  if (result.outcome === 'failed') return `failed (exit ${result.exitCode ?? '?'})`;
  return result.outcome.replace('_', ' ');
}

export function checkLines(body: CheckBody | null): string[] {
  if (!body) return [];
  const lines = body.results.map((result) => `- \`${result.command}\` ${resultStatus(result)}`);
  const failing = failingChecks(body);
  if (failing.length > 0) lines.push('', checkFailureText(failing));
  return lines;
}
