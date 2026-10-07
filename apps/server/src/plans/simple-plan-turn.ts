import { modePosture, isReadOnlyPosture } from '@spark-outpost/contracts';
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

export function isPlanTurn(input: RunInput): boolean {
  if (input.parentRunId !== null || input.assistant || input.projectRoots.length === 0)
    return false;
  return planCommandText(input.userRequest) !== null || pickedPlanMode(input);
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

export async function markPlanTurn(db: Db, runId: string): Promise<void> {
  await db.query(`UPDATE runs SET mode = 'do' WHERE id = $1`, [runId]);
}
