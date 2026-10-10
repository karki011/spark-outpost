import type { Db } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { plansThisTurn } from './plan-mode.ts';
import { asPlanTurn, isPlanCommand, isPlanModeChat, markPlanTurn } from './simple-plan-turn.ts';

export function startsInPlanMode(input: RunInput): boolean {
  return isPlanCommand(input) || isPlanModeChat(input);
}

export async function chatPlanInput(db: Db, input: RunInput): Promise<RunInput> {
  if (!startsInPlanMode(input)) return { ...input, planning: plansThisTurn(input, true) };
  return markPlanTurn(db, asPlanTurn(input));
}
