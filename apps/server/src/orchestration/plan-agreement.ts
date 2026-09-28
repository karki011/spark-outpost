import type { JevStatus, PlanDocument } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import type { IntakeResult } from '../advisor/intake-recorder.ts';
import type { Db } from '../persistence/db.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { planForMessage, previousAssistantMessage } from '../persistence/plan-documents.ts';
import { saveAgreedMessage } from '../plans/agreed-plans.ts';
import { agreesByRule, planAgreementAction, type PlanAgreementAction } from '../plans/agreement.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { announcePlan, planNote, planSaveFailed } from '../workflow/plan-recorder.ts';
import type { RunInput } from '../workflow/run-input.ts';

export interface PlanAgreementDeps {
  db: Db;
  runId: string;
  input: RunInput;
  intake: IntakeResult;
  append: Append;
}

const SUMMARIES: Record<PlanAgreementAction, string> = {
  save: 'Saved the previous reply as the agreed plan',
  offer: 'Offered to save the previous reply as the agreed plan',
  none: 'No plan agreement',
};

function jevStatus(intake: IntakeResult): JevStatus {
  return intake.outcome.status === 'not_connected' ? 'not_connected' : 'not_asked';
}

export async function observePlanAgreement(deps: PlanAgreementDeps): Promise<PlanDocument | null> {
  const previous = await previousAssistantMessage(deps.db, deps.runId);
  if (!previous) return null;
  const outcome = deps.intake.outcome;
  const noul = outcome.status === 'answered' ? (outcome.intake.planAgreed ?? null) : null;
  const already = (await planForMessage(deps.db, previous.id))?.status === 'approved';
  const action = already ? 'none' : planAgreementAction(noul);
  let saved: PlanDocument | null = null;
  let error: string | null = null;
  if (action === 'save') {
    try {
      saved = await saveAgreedMessage(deps.db, previous, {
        by: 'jev',
        source: 'chat',
        root: deps.input.projectRoots[0] ?? null,
        approvedRunId: deps.runId,
      });
      await announcePlan(deps.append, saved);
      await planNote(deps.append, `Saved the previous reply as agreed plan v${saved.version}`);
    } catch (caught) {
      error = await planSaveFailed(deps.append, caught);
    }
  }
  await insertDecision(deps.db, {
    runId: deps.runId,
    purpose: 'plan_agreed',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: jevStatus(deps.intake),
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: error ? `${SUMMARIES.save} failed` : SUMMARIES[action],
      applied: action,
      gate: null,
      answer: {
        observation: true,
        jev: noul,
        rule: agreesByRule(deps.input.userRequest),
        action,
        alreadySaved: already,
        messageId: previous.id,
        planId: saved?.id ?? null,
        error,
      },
    },
  });
  return saved;
}
