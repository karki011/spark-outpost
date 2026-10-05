import {
  MODEL_SWITCH_ACTIVITY,
  providerIdSchema,
  signInName,
  unavailableText,
  type CapabilityOption,
  type ModelRef,
  type ModelSwitch,
  type ProviderId,
} from '@spark-outpost/contracts';
import { availabilityOf, type StoredAccess } from '../model-access/access.ts';
import { loadAccess, markModelRejected } from '../model-access/store.ts';
import { replacementFor } from '../model-access/view.ts';
import type { Queryable } from '../persistence/db.ts';
import { catalogEntry } from '../providers/catalog.ts';
import {
  ModelRejectedError,
  ProviderError,
  type AgentSettings,
  type Provider,
  type ProviderOutput,
  type ProviderTurn,
} from '../providers/provider.ts';
import { runEvents } from './run-events.ts';
import type { RunEvent } from '@spark-outpost/contracts';

interface KnownModels {
  provider: ProviderId;
  access: StoredAccess | null;
  models: ModelRef[];
}

async function knownModels(
  db: Queryable,
  workspaceId: string,
  providerName: string,
): Promise<KnownModels | null> {
  const provider = providerIdSchema.safeParse(providerName);
  if (!provider.success) return null;
  const { rows } = await db.query<{ models: CapabilityOption[] }>(
    'SELECT models FROM provider_capabilities WHERE workspace_id = $1 AND provider = $2',
    [workspaceId, provider.data],
  );
  return {
    provider: provider.data,
    access: await loadAccess(db, workspaceId, provider.data),
    models: (rows[0]?.models ?? []).map(({ id, label }) => ({ id, label })),
  };
}

function refOf(known: KnownModels, id: string, label: string | null = null): ModelRef {
  return { id, label: known.models.find((model) => model.id === id)?.label ?? label ?? id };
}

function switchFrom(known: KnownModels, from: ModelRef, learned: boolean): ModelSwitch {
  return {
    provider: known.provider,
    signIn: signInName(
      known.provider,
      catalogEntry(known.provider).name,
      known.access?.account ?? null,
    ),
    from,
    to: replacementFor(known.provider, known.access, known.models, from),
    learned,
  };
}

export interface GuardedSettings {
  settings: AgentSettings;
  change: ModelSwitch | null;
}

export async function usableSettings(
  db: Queryable,
  workspaceId: string,
  provider: string,
  settings: AgentSettings,
): Promise<GuardedSettings> {
  const known = settings.model === null ? null : await knownModels(db, workspaceId, provider);
  if (!known || settings.model === null) return { settings, change: null };
  if (availabilityOf(known.access, settings.model) !== 'unusable')
    return { settings, change: null };
  const change = switchFrom(known, refOf(known, settings.model, settings.modelLabel), false);
  return { settings: withModel(settings, change.to), change };
}

function withModel(settings: AgentSettings, model: ModelRef | null): AgentSettings {
  return model ? { ...settings, model: model.id, modelLabel: model.label } : settings;
}

type AppendEvent = (event: RunEvent) => Promise<unknown>;

export function switchNote(change: ModelSwitch): string {
  const cannot = `${change.from.label} isn't usable with your ${change.signIn}`;
  return change.to ? `${cannot}; using ${change.to.label}` : `${cannot}; nothing else to switch to`;
}

export async function recordModelSwitch(
  db: Queryable,
  runId: string,
  append: AppendEvent,
  change: ModelSwitch,
): Promise<void> {
  await db.query('UPDATE runs SET model_switch = $2 WHERE id = $1', [
    runId,
    JSON.stringify(change),
  ]);
  const note = switchNote(change);
  await append(runEvents.stepStarted(note));
  await append(runEvents.stepFinished(note));
  await append(runEvents.activity(MODEL_SWITCH_ACTIVITY, MODEL_SWITCH_ACTIVITY, { ...change }));
}

export async function recordErrorDetails(
  db: Queryable,
  runId: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof ProviderError) || !error.details) return;
  if (error.message.includes(error.details)) return;
  await db.query('UPDATE runs SET error_details = $2 WHERE id = $1', [runId, error.details]);
}

function startsWork(output: ProviderOutput): boolean {
  if (output.kind === 'step_started') return output.tool === true;
  return (
    output.kind === 'text_delta' ||
    output.kind === 'file_focus' ||
    output.kind === 'plan_proposed' ||
    output.kind === 'rail_flag'
  );
}

export function unusableMessage(change: ModelSwitch, worked: boolean): string {
  const cannot = unavailableText(change.signIn, change.from.label);
  const why = worked
    ? ' This turn had already started work, so Spark did not run it again on another model.'
    : '';
  return `${cannot}${why} Pick another model in Settings > Models, then send the message again.`;
}

export interface ModelGuard {
  db: Queryable;
  workspaceId: string;
  provider: string;
  runId: string;
  append: AppendEvent;
}

async function learn(
  guard: ModelGuard,
  error: ModelRejectedError,
  ranOn: string | null,
): Promise<ModelSwitch | null> {
  const known = await knownModels(guard.db, guard.workspaceId, guard.provider);
  if (!known) return null;
  const named = known.models.some((model) => model.id === error.model) ? error.model : null;
  const rejected = named ?? ranOn ?? error.model;
  if (!rejected) return null;
  const from = refOf(known, rejected);
  await markModelRejected(guard.db, guard.workspaceId, known.provider, from);
  const access = await loadAccess(guard.db, guard.workspaceId, known.provider);
  return switchFrom({ ...known, access }, from, true);
}

export async function* guardedRun(
  guard: ModelGuard,
  provider: Provider,
  turn: ProviderTurn,
): AsyncGenerator<ProviderOutput> {
  let settings = turn.settings;
  let retried = false;
  for (;;) {
    let worked = false;
    let ranOn = settings.model;
    try {
      for await (const output of provider.run({ ...turn, settings })) {
        worked ||= startsWork(output);
        if (output.kind === 'session_settings' && output.model) ranOn = output.model;
        yield output;
      }
      return;
    } catch (error) {
      if (!(error instanceof ModelRejectedError) || turn.signal.aborted) throw error;
      const change = await learn(guard, error, ranOn);
      if (!change) throw error;
      if (retried || worked || !change.to) {
        await recordModelSwitch(guard.db, guard.runId, guard.append, { ...change, to: null });
        throw new ProviderError(unusableMessage(change, worked), error.details);
      }
      retried = true;
      await recordModelSwitch(guard.db, guard.runId, guard.append, change);
      settings = withModel(settings, change.to);
    }
  }
}
