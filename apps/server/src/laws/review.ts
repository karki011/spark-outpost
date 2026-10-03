import { LAW_ITEMS_SHOWN, POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import type { Session } from '../orchestration/session.ts';
import { claimFindings, type BuilderReply } from './claims.ts';
import type { LawFacts, LawFinding } from './finding.ts';
import { guardFindings } from './goodhart.ts';
import { removalFindings } from './removals.ts';

export type RemovalSource = 'critic' | 'rules';

export interface LawReview {
  findings: LawFinding[];
  removalsBy: RemovalSource;
}

export function builderReplies(s: Pick<Session, 'results'>): BuilderReply[] {
  return s.results
    .filter((result) => result.role === 'builder' && result.text.trim())
    .map((result) => ({ runId: result.runId, name: result.name, text: result.text }));
}

export function lawFacts(
  s: Pick<Session, 'input' | 'results' | 'plan'>,
  agreedPlan: string | null,
): LawFacts {
  return {
    request: s.input.userRequest,
    replies: builderReplies(s).map((reply) => reply.text),
    plan: [...s.plan.map((entry) => entry.content), ...(agreedPlan ? [agreedPlan] : [])],
  };
}

function criticRemovals(removed: readonly string[]): LawFinding[] {
  return removed.map((text) => ({ law: 'chesterton', kind: 'symbol', path: null, text }));
}

export function reviewLaws(
  s: Pick<Session, 'input' | 'results' | 'plan' | 'checkBodies' | 'criticRemovals'>,
  patch: string,
  agreedPlan: string | null,
): LawReview {
  const facts = lawFacts(s, agreedPlan);
  const byCritic = s.criticRemovals !== undefined && s.criticRemovals !== null;
  const removals = byCritic
    ? criticRemovals(s.criticRemovals ?? [])
    : removalFindings(patch, facts);
  return {
    findings: [
      ...removals,
      ...claimFindings(builderReplies(s), s.checkBodies),
      ...guardFindings(patch, facts),
    ],
    removalsBy: byCritic ? 'critic' : 'rules',
  };
}

export function lawItems(s: Pick<Session, 'laws'>): string[] {
  return (s.laws?.findings ?? []).slice(0, LAW_ITEMS_SHOWN).map((finding) => finding.text);
}

export function lawsNote(s: Pick<Session, 'laws'>): string | null {
  const findings = s.laws?.findings ?? [];
  if (findings.length === 0) return null;
  const more =
    findings.length > LAW_ITEMS_SHOWN ? `\n- and ${findings.length - LAW_ITEMS_SHOWN} more` : '';
  const items = lawItems(s).map((text) => `- ${text}`);
  return `Worth a look:\n${items.join('\n')}${more}`;
}

function lawSummary(review: LawReview): string {
  const count = review.findings.length;
  if (count === 0)
    return `No unexplained removals or weakened checks (removals by ${review.removalsBy})`;
  return `${count} thing${count === 1 ? '' : 's'} to check (removals by ${review.removalsBy})`;
}

export async function recordLaws(s: Session, review: LawReview): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'law',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: lawSummary(review),
      applied: 'rules',
      gate: null,
      jevError: null,
      latencyMs: null,
      answer: { law: 'findings', removalsBy: review.removalsBy, findings: review.findings },
    },
  });
}
