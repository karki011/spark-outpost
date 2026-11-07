import type { RecapRefineRequest, RecapState } from '@spark-outpost/contracts';
import { digestModelFor } from '../digest/service.ts';
import type { Db } from '../persistence/db.ts';
import { recapRows } from '../persistence/recap-facts.ts';
import { getSetupState } from '../persistence/setup.ts';
import {
  latestRecap,
  recapForRefine,
  recapRefines,
  recapSetting,
  startRecap,
  startRefine,
} from '../persistence/week-recaps.ts';
import { buildRecapFacts } from './facts.ts';
import { buildRecapPrompt, buildRefinePrompt, fittedFacts } from './prompt.ts';
import { localDay, recapDue, weekStart } from './week.ts';

export class RecapNotFoundError extends Error {}
export class RecapNotReadyError extends Error {}

function weekLabel(since: Date, now: Date): string {
  const format = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${format.format(since)} – ${format.format(now)}`;
}

export async function recapState(db: Db, workspaceId: string, now = new Date()) {
  const [setup, setting] = await Promise.all([
    getSetupState(db, workspaceId),
    recapSetting(db, workspaceId),
  ]);
  const recap = await latestRecap(db, workspaceId, localDay(weekStart(now)), now);
  const state: RecapState = {
    available: setup.profile.defaultProvider !== null,
    enabled: setting.enabled,
    due: recapDue(now, setting.day, setting.time),
    recap,
    refines: recap ? await recapRefines(db, recap.id, now) : [],
  };
  return state;
}

export async function requestRecap(
  db: Db,
  workspaceId: string,
  now = new Date(),
): Promise<RecapState> {
  const provider = (await getSetupState(db, workspaceId)).profile.defaultProvider;
  if (!provider) return recapState(db, workspaceId, now);
  const since = weekStart(now);
  const week = weekLabel(since, now);
  const gathered = buildRecapFacts(await recapRows(db, workspaceId, since));
  const facts = fittedFacts(gathered.facts, week);
  const model = await digestModelFor(db, workspaceId, provider);
  await startRecap(db, workspaceId, {
    provider,
    model: model.model,
    modelLabel: model.label,
    effort: model.effort,
    weekStart: localDay(since),
    since,
    until: now,
    prompt: buildRecapPrompt(facts, week),
    facts: { week, facts, totals: gathered.totals },
  });
  return recapState(db, workspaceId, now);
}

export async function refineRecap(
  db: Db,
  workspaceId: string,
  recapId: string,
  request: RecapRefineRequest,
): Promise<RecapState> {
  const found = await recapForRefine(db, workspaceId, recapId);
  if (!found) throw new RecapNotFoundError('That recap no longer exists.');
  if (found.recap.status !== 'ready') throw new RecapNotReadyError('The recap is still being written.');
  await startRefine(db, workspaceId, recapId, {
    voice: request.voice,
    instruction: request.instruction,
    textIn: request.text,
    prompt: buildRefinePrompt(
      found.facts.facts,
      found.facts.week,
      request.voice,
      request.text,
      request.instruction,
    ),
    model: found.model,
  });
  return recapState(db, workspaceId);
}
