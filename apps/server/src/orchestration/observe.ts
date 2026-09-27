import { buildPolicyQuestions, editDiff, policyVerdict } from '../advisor/policy-gate.ts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import {
  buildVerifyQuestions,
  requirementLines,
  verifyVerdict,
} from '../advisor/verify-questions.ts';
import type { Queryable } from '../persistence/db.ts';
import { insertDecision, type NewDecision } from '../persistence/orchestrations.ts';
import type { EditObserver, ObservedDecision } from '../workflow/approval-gate.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import { changesSoFar } from './member-prompts.ts';
import type { MemberResult, Session } from './session.ts';

export const DIFFS_OFF = 'skipped: diffs off';

export async function jevDiffsAllowed(db: Queryable, workspaceId: string): Promise<boolean> {
  const { rows } = await db.query<{ jev_diffs: boolean }>(
    'SELECT jev_diffs FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.jev_diffs ?? true;
}

type Purpose = Extract<NewDecision['purpose'], 'policy' | 'verify'>;

function record(
  s: Session,
  purpose: Purpose,
  childRunId: string | null,
  call: JevCall | null,
  summary: string,
  answer: Record<string, unknown>,
): Promise<void> {
  return insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose,
    childRunId,
    role: 'builder',
    stepIndex: 0,
    jevStatus: call?.status ?? 'not_asked',
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    policyVersion: POLICY_VERSION,
    body: {
      summary,
      applied: 'rules',
      gate: null,
      jevError: call?.error ?? null,
      jevModel: call?.model ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: { observation: true, ...answer },
      state: call?.asked?.state ?? null,
      questions: call?.asked?.questions ?? null,
      answers: call?.response?.answers ?? null,
    },
  });
}

function track(s: Session, work: Promise<void>): void {
  const settled = work.catch((error: unknown) =>
    console.error('Could not record an observation', error),
  );
  s.observations.push(settled);
}

const ACTUAL: Record<ObservedDecision['verdict'], string> = {
  allow: 'allowed',
  reject: 'refused',
  ask: 'asked you',
};

async function observeEdit(
  s: Session,
  childRunId: string,
  request: ApprovalRequest,
  decision: ObservedDecision,
): Promise<void> {
  const path = request.paths[0] ?? request.diffs[0]?.path ?? '';
  const actual = { verdict: decision.verdict, by: decision.by, approvalId: decision.approvalId };
  if (!s.jevDiffs) {
    await record(s, 'policy', childRunId, null, DIFFS_OFF, { path, actual, would: null });
    return;
  }
  const call = await callJev(
    s.jev,
    () =>
      buildPolicyQuestions({ request: s.input.userRequest, path, diff: editDiff(request.diffs) }),
    s.control.signal,
  );
  const verdict = policyVerdict(call.status === 'answered' ? call.response : null);
  const max = verdict.max === null ? 'no answer' : verdict.max.toFixed(2);
  const summary = `Policy gate would ${verdict.action} ${path} (max ${max}); the rules ${ACTUAL[decision.verdict]}`;
  await record(s, 'policy', childRunId, call, summary, {
    path,
    actual,
    would: verdict.action,
    ...verdict,
  });
}

export function editObserver(s: Session, childRunId: string): EditObserver | undefined {
  if (!s.jev) return undefined;
  return (request, decision) => track(s, observeEdit(s, childRunId, request, decision));
}

async function verify(s: Session, builder: MemberResult): Promise<void> {
  const { patch } = await changesSoFar(s);
  if (!patch.trim()) return;
  const requirements = requirementLines(
    s.input.userRequest,
    s.plan.map((entry) => entry.content),
  );
  if (!s.jevDiffs) {
    await record(s, 'verify', builder.runId, null, DIFFS_OFF, { requirements, would: null });
    return;
  }
  const call = await callJev(
    s.jev,
    () => buildVerifyQuestions({ request: s.input.userRequest, requirements, diff: patch }),
    s.control.signal,
  );
  const verdict = verifyVerdict(requirements, call.status === 'answered' ? call.response : null);
  const flagged = verdict.unmet.filter((entry) => (entry.noul ?? 0) >= 0.5).length;
  const summary = `Verifier would ${verdict.would === 'flag' ? 'flag this change' : verdict.would === 'review' ? 'ask for a review' : 'pass it'} (${flagged} of ${requirements.length} requirements look unmet${verdict.weakensTests !== null && verdict.weakensTests >= 0.5 ? '; tests look weakened' : ''})`;
  await record(s, 'verify', builder.runId, call, summary, { requirements, ...verdict });
}

export function observeBuilder(s: Session, builder: MemberResult): void {
  if (!s.jev || builder.role !== 'builder' || builder.outcome !== 'succeeded') return;
  track(s, verify(s, builder));
}

export async function settleObservations(s: Session): Promise<void> {
  while (s.observations.length > 0) {
    const pending = s.observations.splice(0);
    await Promise.all(pending);
  }
}
