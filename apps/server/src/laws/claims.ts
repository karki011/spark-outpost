import type { CheckBody, CheckResult } from '@spark-outpost/contracts';
import { code, type LawFinding } from './finding.ts';

export interface BuilderReply {
  runId: string;
  name: string;
  text: string;
}

const PASS_CLAIM =
  /\b(?:all |the )?(?:tests?|checks?|specs?|lint(?:ing)?|type ?checks?|typecheck(?:ing)?|builds?|test suite|ci)\b[^.\n]{0,40}\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean|ok)\b|\b(?:tests?|checks?)\b[^.\n]{0,20}\ball pass/i;

const NEGATED =
  /\b(?:not|n't|never|fail\w*|couldn't|could not|unable|without running|didn't run|did not run)\b/i;

export function claimsChecksPass(text: string): boolean {
  return text
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => PASS_CLAIM.test(sentence) && !NEGATED.test(sentence));
}

function failed(result: CheckResult): boolean {
  return result.outcome === 'failed' || result.outcome === 'timed_out';
}

function failureText(result: CheckResult): string {
  if (result.outcome === 'timed_out') return `${code(result.command)} timed out`;
  return `${code(result.command)} exited ${result.exitCode ?? 'with an error'}`;
}

function contradiction(reply: BuilderReply, body: CheckBody): string | null {
  const failing = body.results.filter(failed);
  if (failing.length > 0) {
    return `${reply.name} said the checks pass, but Spark's own run failed: ${failing.map(failureText).join(', ')}.`;
  }
  if (body.status === 'skipped') {
    const note = body.results.find((result) => result.note)?.note ?? 'they were not run';
    return `${reply.name} said the checks pass, but Spark could not confirm it: ${note}`;
  }
  return null;
}

export function claimFindings(
  replies: readonly BuilderReply[],
  bodies: readonly CheckBody[],
): LawFinding[] {
  const found: LawFinding[] = [];
  for (const reply of replies) {
    if (!claimsChecksPass(reply.text)) continue;
    const body = bodies.findLast((entry) => entry.runId === reply.runId);
    const text = body ? contradiction(reply, body) : null;
    if (text) found.push({ law: 'goodhart', kind: 'claim', path: null, text });
  }
  return found;
}
