import { LAW_ITEMS_SHOWN, POLICY_VERSION } from '../advisor/policy.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import type { Session } from '../orchestration/session.ts';
import { claimFindings, type BuilderReply } from './claims.ts';
import { code, type LawFacts, type LawFinding } from './finding.ts';
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
    followUp: s.input.followUpRound === true,
    reviewed: s.results.some(
      (result) => result.role === 'critic' && result.outcome === 'succeeded',
    ),
  };
}

function sameFinding(finding: LawFinding): string {
  const text = finding.text.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${finding.kind}\u0000${finding.path ?? ''}\u0000${text}`;
}

export function distinctFindings(findings: readonly LawFinding[]): LawFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = sameFinding(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    findings: distinctFindings([
      ...removals,
      ...claimFindings(builderReplies(s), s.checkBodies),
      ...guardFindings(patch, facts),
    ]),
    removalsBy: byCritic ? 'critic' : 'rules',
  };
}

function shownFindings(s: Pick<Session, 'laws'>): LawFinding[] {
  return (s.laws?.findings ?? []).filter((finding) => finding.kind !== 'scope');
}

export function lawItems(s: Pick<Session, 'laws'>): string[] {
  return shownFindings(s)
    .slice(0, LAW_ITEMS_SHOWN)
    .map((finding) => finding.text);
}

export function outsidePlanFiles(s: Pick<Session, 'laws'>): string[] {
  return (s.laws?.findings ?? []).flatMap((finding) =>
    finding.kind === 'scope' && finding.path ? [finding.path] : [],
  );
}

export function outsidePlanLine(files: readonly string[]): string | null {
  if (files.length === 0) return null;
  const count = `${files.length} file${files.length === 1 ? '' : 's'}`;
  return `${count} outside the plan: ${files.map(code).join(', ')}`;
}

export function lawsNote(s: Pick<Session, 'laws'>): string | null {
  const shown = shownFindings(s);
  const outside = outsidePlanLine(outsidePlanFiles(s));
  if (shown.length === 0 && !outside) return null;
  const more = shown.length > LAW_ITEMS_SHOWN ? [`and ${shown.length - LAW_ITEMS_SHOWN} more`] : [];
  const items = [...lawItems(s), ...more, ...(outside ? [outside] : [])];
  return `Worth a look:\n${items.map((text) => `- ${text}`).join('\n')}`;
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
