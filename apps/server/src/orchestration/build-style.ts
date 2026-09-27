import {
  buildStyleSchema,
  DEFAULT_BUILD_STYLE,
  type BuildStyle,
  type Gate,
  type JevStatus,
  type ShortcutsBody,
} from '@spark-outpost/contracts';
import type { JevOutcome } from '../advisor/advice-body.ts';
import { allowedStyles } from '../advisor/build-style-question.ts';
import { ACT_AT_DOWNGRADE, ASK_AT } from '../advisor/gate.ts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import { nextArtifactVersion } from '../persistence/artifacts.ts';
import type { Queryable } from '../persistence/db.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { runEvents } from '../workflow/run-events.ts';
import { harvestShortcuts, ruleBuildStyle, type ProjectStyle, type StyleRule } from './lean.ts';
import { changesSoFar } from './member-prompts.ts';
import type { Session } from './session.ts';

export const NO_PROJECT_STYLE: ProjectStyle = { style: 'off', source: 'project setting' };

export async function projectBuildStyle(db: Queryable, runId: string): Promise<ProjectStyle> {
  const { rows } = await db.query<{ build_style: string | null }>(
    `SELECT p.build_style FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     JOIN projects p ON p.id = cp.project_id
     WHERE r.id = $1
     ORDER BY cp.position, cp.created_at
     LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return NO_PROJECT_STYLE;
  if (row.build_style === null) return { style: DEFAULT_BUILD_STYLE, source: 'default' };
  const style = buildStyleSchema.catch(DEFAULT_BUILD_STYLE).parse(row.build_style);
  return { style, source: 'project setting' };
}

export { allowedStyles };

export interface StylePick {
  style: BuildStyle;
  confidence: number;
}

export function parseStyleAnswer(
  response: SystemOneResponse,
  project: BuildStyle,
): StylePick | null {
  const answer = response.answers.build_style;
  if (answer?.type !== 'choice') return null;
  const style = allowedStyles(project).find((option) => option === answer.choice);
  return style ? { style, confidence: answer.confidence } : null;
}

export interface StyleChoice {
  style: BuildStyle;
  applied: 'jev' | 'rules';
  gate: Gate | null;
}

export function chooseStyle(rule: StyleRule, pick: StylePick | null, s: Session): StyleChoice {
  if (!pick) return { style: rule.style, applied: 'rules', gate: null };
  const acts = pick.confidence >= ACT_AT_DOWNGRADE;
  const gate: Gate = {
    decision: acts ? 'act' : 'fallback',
    confidence: pick.confidence,
    risk: s.flow.risk,
    level: s.flow.level,
    actAt: ACT_AT_DOWNGRADE,
    askAt: ASK_AT,
    clarifyBelow: null,
  };
  return { style: acts ? pick.style : rule.style, applied: acts ? 'jev' : 'rules', gate };
}

export function styleSummary(choice: StyleChoice, rule: StyleRule, pick: StylePick | null): string {
  const jev = pick
    ? `Jev said ${pick.style} at ${pick.confidence.toFixed(2)}`
    : 'Jev did not answer';
  return `Build style ${choice.style} · rule would have used ${rule.style} (${rule.reason}) · ${jev}`;
}

interface IntakeStyle {
  status: JevStatus;
  response: SystemOneResponse | null;
  model: string | null;
  error: string | null;
}

export function intakeStyle(outcome: JevOutcome): IntakeStyle {
  if (outcome.status === 'not_connected') {
    return { status: 'not_connected', response: null, model: null, error: null };
  }
  if (outcome.status !== 'answered') {
    return { status: outcome.status, response: null, model: null, error: outcome.error };
  }
  const asked = outcome.response.answers.build_style !== undefined;
  return {
    status: asked ? 'not_asked' : 'failed',
    response: outcome.response,
    model: outcome.response.model,
    error: asked ? null : 'Jev did not answer build_style.',
  };
}

function styleAnswers(response: SystemOneResponse | null) {
  const answer = response?.answers.build_style;
  return answer ? { build_style: answer } : null;
}

export async function decideBuildStyle(s: Session): Promise<void> {
  if (s.buildStyleDecided) return;
  s.buildStyleDecided = true;
  const { style: project, source } = s.projectStyle;
  if (project === 'off') return;
  const rule = ruleBuildStyle(project, s.input.mode, s.input.userRequest, source);
  const call = intakeStyle(s.intake.outcome);
  const pick = call.response ? parseStyleAnswer(call.response, project) : null;
  const choice = chooseStyle(rule, pick, s);
  s.buildStyle = choice.style;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'build_style',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: call.status,
    inputTokens: null,
    costUsd: null,
    body: {
      summary: styleSummary(choice, rule, pick),
      applied: choice.applied,
      gate: choice.gate,
      jevError: call.error,
      jevModel: call.model,
      latencyMs: null,
      answer: {
        project,
        rule: rule.style,
        ruleReason: rule.reason,
        jev: pick?.style ?? null,
        confidence: pick?.confidence ?? null,
        chosen: choice.style,
      },
      reusedFrom: call.response ? 'intake' : null,
      answers: styleAnswers(call.response),
    },
  });
}

export async function recordShortcuts(s: Session): Promise<ShortcutsBody | null> {
  if (s.buildStyle === 'off' || !s.taskId) return null;
  const { patch } = await changesSoFar(s);
  const entries = harvestShortcuts(patch);
  if (entries.length === 0) return null;
  const body: ShortcutsBody = { runId: s.lease.runId, style: s.buildStyle, entries };
  const version = await nextArtifactVersion(s.deps.db, s.taskId, 'shortcuts');
  await s.append(runEvents.activity('artifact:shortcuts', 'shortcuts', { version, body }), {
    artifact: {
      taskId: s.taskId,
      kind: 'shortcuts',
      body,
      version,
      overwrite: false,
      supersedesPrevious: false,
    },
  });
  return body;
}
