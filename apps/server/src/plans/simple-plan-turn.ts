import {
  CATEGORY_CONFIDENCE_FLOOR,
  modePosture,
  isReadOnlyPosture,
  type Category,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import type { turnIntent } from '../orchestration/intake.ts';
import { buildsByRule, planOnlyByRule, questionByRule } from '../orchestration/risk-rules.ts';
import { resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { PLAN_MODE_ID } from './plan-mode.ts';

const PLAN_COMMAND = /^\s*\/plan(?:\s+|$)/i;

export function planCommandText(prompt: string): string | null {
  if (!PLAN_COMMAND.test(prompt)) return null;
  return prompt.replace(PLAN_COMMAND, '').trim();
}

function pickedPlanMode(input: RunInput): boolean {
  return input.agentMode === PLAN_MODE_ID || input.settings.mode === PLAN_MODE_ID;
}

function mayPlan(input: RunInput): boolean {
  return input.parentRunId === null && !input.assistant && input.projectRoots.length > 0;
}

export function isPlanCommand(input: RunInput): boolean {
  return mayPlan(input) && planCommandText(input.userRequest) !== null;
}

export function isPlanModeChat(input: RunInput): boolean {
  return mayPlan(input) && pickedPlanMode(input);
}

const BUILD_INTENTS: ReadonlySet<Category> = new Set([
  'bug_fix',
  'feature',
  'refactor',
  'tests',
  'docs',
  'config',
]);

export function asksToBuild(request: string, jev: Parameters<typeof turnIntent>[0]): boolean {
  const confidence = jev ? (jev.confidences.intent ?? jev.confidence) : 0;
  if (jev?.intent && confidence >= CATEGORY_CONFIDENCE_FLOOR) return BUILD_INTENTS.has(jev.intent);
  return buildsByRule(request) && !questionByRule(request) && !planOnlyByRule(request);
}

function buildingMode(input: RunInput): string | null {
  const mode = input.settings.mode ?? null;
  return isReadOnlyPosture(modePosture(input.provider, mode)) ? null : mode;
}

export function asPlanTurn(input: RunInput): RunInput {
  const asked = planCommandText(input.userRequest);
  const request = asked === null || asked === '' ? input.userRequest : asked;
  return {
    ...input,
    prompt: asked === null ? input.prompt : request,
    userRequest: request,
    mode: 'do',
    planning: false,
    plansFirst: true,
    settings: { ...input.settings, mode: buildingMode(input) },
  };
}

export async function markPlanTurn(db: Db, input: RunInput): Promise<RunInput> {
  const chat = await resolveChatSettings(db, input.identity.threadId);
  const { rows } = await db.query<{ level: InvolvementLevel }>(
    `UPDATE runs SET mode = 'do', level = COALESCE(level, $2) WHERE id = $1 RETURNING level`,
    [input.identity.runId, chat.level],
  );
  return { ...input, level: rows[0]?.level ?? input.level };
}
