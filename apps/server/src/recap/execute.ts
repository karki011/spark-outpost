import type { Lease } from '../persistence/jobs.ts';
import {
  finishRecap,
  finishRefine,
  recapFactsByRun,
  refineContextByRun,
  type RecapRunKind,
} from '../persistence/week-recaps.ts';
import type { TurnDeps } from '../workflow/agent-turn.ts';
import { executeChildRun } from '../workflow/execute-run.ts';
import { groundRefinedText, parseRecapReply } from './parse.ts';

const RECAP_FAILED = 'The recap could not be written. Try again.';
const REFINE_FAILED = 'The rewrite could not be written. Try again.';

async function executeRecapRun(deps: TurnDeps, lease: Lease): Promise<void> {
  const result = await executeChildRun(deps, lease);
  if (result.outcome === 'lease_lost') return;
  if (result.outcome !== 'succeeded') {
    await finishRecap(deps.db, lease.runId, { error: result.error ?? RECAP_FAILED });
    return;
  }
  const body = parseRecapReply(result.text, await recapFactsByRun(deps.db, lease.runId));
  await finishRecap(deps.db, lease.runId, body ? { body } : { error: RECAP_FAILED });
}

async function executeRefineRun(deps: TurnDeps, lease: Lease): Promise<void> {
  const result = await executeChildRun(deps, lease);
  if (result.outcome === 'lease_lost') return;
  if (result.outcome !== 'succeeded') {
    await finishRefine(deps.db, lease.runId, { error: result.error ?? REFINE_FAILED });
    return;
  }
  const context = await refineContextByRun(deps.db, lease.runId);
  const text = context ? groundRefinedText(result.text, context.facts, context.textIn) : null;
  await finishRefine(deps.db, lease.runId, text ? { text } : { error: REFINE_FAILED });
}

export function executeRecap(deps: TurnDeps, lease: Lease, kind: RecapRunKind): Promise<void> {
  return kind === 'recap' ? executeRecapRun(deps, lease) : executeRefineRun(deps, lease);
}
