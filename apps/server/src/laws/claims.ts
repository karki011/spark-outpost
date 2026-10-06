import {
  checkCause,
  failingChecks,
  unsettledChecks,
  type CheckBody,
  type CheckResult,
} from '@spark-outpost/contracts';
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

const NAMED_LIMIT = 6;

function named(result: CheckResult, ids: readonly string[] = result.failures ?? []): string {
  if (ids.length === 0) return `exited ${result.exitCode ?? 'with an error'}`;
  const shown = ids.slice(0, NAMED_LIMIT).join(', ');
  const more = ids.length > NAMED_LIMIT ? ` and ${ids.length - NAMED_LIMIT} more` : '';
  return `failed in ${shown}${more}`;
}

function evidence(result: CheckResult): string {
  const base = result.baseline;
  if (base?.trusted !== false && base?.outcome === 'passed') return 'it passes without this change';
  if (base?.outcome === 'failed' && base.trusted !== false) return 'new with this change';
  return 'in files this change touches';
}

function difference(result: CheckResult): string {
  const cause = checkCause(result);
  const command = code(result.command);
  if (cause === 'change') {
    const blamed = result.blamed ?? [];
    const ids = blamed.length > 0 ? blamed : (result.failures ?? []);
    return `${command} ${named(result, ids)} (${evidence(result)})`;
  }
  if (cause === 'baseline') return `${command} ${named(result)}, as it does without this change`;
  if (cause === 'unknown') return `${command} ${named(result)}; nothing ties that to this change`;
  if (cause === 'timeout') return `${command} could not finish in time`;
  if (cause === 'environment') return `${command} could not run`;
  return `${command} was not run`;
}

function contradiction(reply: BuilderReply, body: CheckBody): string | null {
  const differing = [...failingChecks(body), ...unsettledChecks(body)];
  if (differing.length > 0) {
    const lead =
      failingChecks(body).length > 0
        ? "Spark's own run differs"
        : 'Spark could not confirm it, and none of this is counted against the change';
    return `${reply.name} said the checks pass. ${lead}: ${differing.map(difference).join('; ')}.`;
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
