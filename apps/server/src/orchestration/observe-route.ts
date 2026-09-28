import { checkBodySchema, failingChecks, type JevStatus } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import type { ScanReport } from '../codescan/scan.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import {
  routeVariant,
  shadowSummary,
  ROUTE_KEY,
  type VariantResult,
} from '../routing/route-answer.ts';
import { routePolicy, type RoutePolicy } from '../routing/route-policy.ts';
import { routeQuestion } from '../routing/route-question.ts';
import {
  evidenceText,
  routeState,
  type RouteInputs,
  type RouteVariant,
} from '../routing/route-state.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import { rankFiles, type Ranking } from './observe-rank.ts';
import { builderFacts } from './member-routes.ts';
import { builderTierPick } from './routing.ts';
import type { Session } from './session.ts';

async function lastFailingCheck(s: Session): Promise<string | null> {
  if (!s.continuesTask) return null;
  const { rows } = await s.deps.db.query<{ body: unknown }>(
    `SELECT a.body FROM run_artifacts a JOIN runs r ON r.id = a.source_run_id
     WHERE a.kind = 'check' AND r.conversation_id = $1 AND r.id <> $2
       AND COALESCE(r.parent_run_id, r.id) <> $2
     ORDER BY a.created_at DESC, a.version DESC LIMIT 1`,
    [s.input.identity.threadId, s.lease.runId],
  );
  const body = checkBodySchema.safeParse(rows[0]?.body);
  if (!body.success || body.data.status !== 'failed') return null;
  return failingChecks(body.data)
    .map(
      (result) =>
        `${result.command} exited ${result.exitCode ?? 'with an error'}\n${result.outputTail}`,
    )
    .join('\n\n');
}

async function routeFacts(s: Session): Promise<RouteInputs> {
  return {
    request: s.input.userRequest,
    priorTurns: s.input.history.map((turn) => ({ role: turn.role, content: turn.content })),
    lastFailingCheck: await lastFailingCheck(s),
    evidence: null,
  };
}

function askRoute(
  s: Session,
  policy: RoutePolicy,
  facts: RouteInputs,
  variant: RouteVariant,
): Promise<JevCall> {
  return callJev(
    s.jev,
    () => ({
      state: routeState(facts, variant),
      questions: { [ROUTE_KEY]: routeQuestion(policy.candidates) },
    }),
    s.control.signal,
  );
}

function variantOf(s: Session, policy: RoutePolicy, call: JevCall | null): VariantResult | null {
  return call ? routeVariant(call, policy, s.route) : null;
}

function total(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function statusOf(s: Session, policy: RoutePolicy, call: JevCall | null): JevStatus {
  if (call) return call.status;
  return policy.kind === 'no_jev' || !s.jev ? 'not_connected' : 'not_asked';
}

async function record(
  s: Session,
  policy: RoutePolicy,
  ranking: Ranking,
  calls: { text: JevCall | null; evidence: JevCall | null },
): Promise<void> {
  const text = variantOf(s, policy, calls.text);
  const evidence = variantOf(s, policy, calls.evidence);
  const asked = [calls.text, calls.evidence].filter((call): call is JevCall => call !== null);
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'route_shadow',
    childRunId: null,
    role: 'builder',
    stepIndex: null,
    jevStatus: statusOf(s, policy, calls.evidence),
    inputTokens: total(asked.map((call) => call.usage?.inputTokens)),
    costUsd: total(asked.map((call) => call.usage?.costUsd)),
    policyVersion: POLICY_VERSION,
    body: {
      summary: shadowSummary(policy, text, evidence),
      applied: policy.kind === 'pinned' ? 'pinned' : 'rules',
      gate: null,
      jevError: calls.evidence?.error ?? null,
      jevModel: calls.evidence?.model ?? calls.text?.model ?? null,
      latencyMs: calls.evidence?.latencyMs ?? null,
      answer: {
        observation: true,
        policy: policy.kind,
        candidates: policy.candidates,
        baselineTier: policy.baselineTier,
        chat: policy.chat,
        rule: { pick: policy.rule.pick, rule: policy.rule.rule },
        codePick: policy.codePick,
        tierPick: builderTierPick(s.route, s.intake.body.jev?.tier ?? null),
        evidenceFiles: ranking.predicted,
        variants: { text, evidence },
      },
      state: {
        text: calls.text?.asked?.state ?? null,
        evidence: calls.evidence?.asked?.state ?? null,
      },
      questions: (calls.evidence ?? calls.text)?.asked?.questions ?? null,
      answers: {
        text: calls.text?.response?.answers ?? null,
        evidence: calls.evidence?.response?.answers ?? null,
      },
    },
  });
}

export async function observeRouting(s: Session, report: ScanReport | null): Promise<void> {
  const policy = routePolicy(s.route, builderFacts(s), s.jev !== null);
  const asking = policy.kind === 'ask';
  const facts = asking ? await routeFacts(s) : null;
  const textCall = facts ? askRoute(s, policy, facts, 'text') : null;
  const ranking = await rankFiles(s, report);
  const withEvidence =
    facts && report ? { ...facts, evidence: evidenceText(report, ranking.files) } : null;
  const evidenceCall = withEvidence ? askRoute(s, policy, withEvidence, 'evidence') : null;
  const [text, evidence] = await Promise.all([textCall, evidenceCall]);
  await record(s, policy, ranking, { text, evidence });
}
