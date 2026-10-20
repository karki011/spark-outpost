import * as acp from '@agentclientprotocol/sdk';
import type { ConfigValues } from '@spark-outpost/contracts';
import {
  ProviderError,
  type AgentSettings,
  type ProviderCapabilityReport,
  type ProviderOutput,
} from '../../providers/provider.ts';
import { PLAN_MODE_ID } from '../../plans/plan-mode.ts';
import type { AgentDefinition } from './agents.ts';
import { capabilitiesFrom, currentValues, isCoreOption, reportedAccess } from './capabilities.ts';
import {
  LEGACY_MODE_OPTION,
  LEGACY_MODEL_OPTION,
  legacyOptions,
  withLegacy,
} from './legacy-options.ts';
import {
  choices,
  currentValue,
  findOption,
  planConfig,
  type ConfigChange,
  type ConfigWish,
} from './session-config.ts';

export interface AppliedSettings {
  notes: string[];
  options: acp.SessionConfigOption[];
  capabilities: ProviderCapabilityReport;
  mode: string | null;
  current: { model: string | null; effort: string | null };
  values: ConfigValues;
  using: string;
  live: SettingsSession;
}

export function settingsOutputs(
  applied: AppliedSettings,
  following: string[] | null,
): ProviderOutput[] {
  return [
    { kind: 'capabilities', report: applied.capabilities },
    { kind: 'session_settings', ...applied.current, mode: applied.mode, options: applied.values },
    ...(following ? [{ kind: 'instructions' as const, files: following }] : []),
  ];
}

const COLLABORATION_CATEGORY = 'collaboration_mode';

export interface ModeWish {
  wanted: string;
  fallback?: string;
  note?: string;
  plan?: boolean;
}

type Requester = Pick<acp.ClientContext, 'request'>;
type SessionHandle = Pick<acp.ActiveSession, 'sessionId' | 'newSessionResponse'>;

function choiceName(option: acp.SessionConfigOption, value: string): string {
  return choices(option).find((choice) => choice.value === value)?.name ?? value;
}

function currentName(options: readonly acp.SessionConfigOption[], category: string) {
  const option = findOption(options, category);
  if (!option || typeof option.currentValue !== 'string') return null;
  return choiceName(option, option.currentValue);
}

function usingLabel(options: readonly acp.SessionConfigOption[], agentName: string): string {
  const model = currentName(options, 'model');
  const effort = currentName(options, 'thought_level');
  const parts = [model, effort && `${effort.toLowerCase()} effort`].filter(Boolean);
  return parts.length > 0 ? `Using ${parts.join(' · ')}` : `Using ${agentName}'s defaults`;
}

export function modeName(options: readonly acp.SessionConfigOption[], mode: string): string {
  const option = findOption(options, 'mode');
  return option ? choiceName(option, mode) : mode;
}

export function offersMode(options: readonly acp.SessionConfigOption[], mode: string): boolean {
  const option = findOption(options, 'mode');
  return option !== undefined && choices(option).some((choice) => choice.value === mode);
}

export interface SettingsSession {
  options(): acp.SessionConfigOption[];
  adopt(options: readonly acp.SessionConfigOption[]): void;
  adoptMode(mode: string): void;
  setMode(mode: string): Promise<void>;
  setValue(configId: string, value: string | boolean): Promise<void>;
  leaveUnpinned(model: string): void;
  unpinnedModel(): string | null;
}

function settingsSession(ctx: Requester, session: SessionHandle): SettingsSession {
  let configOptions = [...(session.newSessionResponse.configOptions ?? [])];
  let legacy = legacyOptions(session.newSessionResponse);
  let unpinned: string | null = null;
  const all = () => withLegacy(configOptions, legacy);
  const noteLegacyMode = (mode: string) => {
    legacy = legacy.map((option) =>
      option.id === LEGACY_MODE_OPTION && option.type === 'select'
        ? { ...option, currentValue: mode }
        : option,
    );
  };
  const setLegacyMode = async (mode: string) => {
    await ctx.request(acp.methods.agent.session.setMode, {
      sessionId: session.sessionId,
      modeId: mode,
    });
    noteLegacyMode(mode);
  };
  const setValue = async (configId: string, value: string | boolean) => {
    const response = await ctx.request(acp.methods.agent.session.setConfigOption, {
      sessionId: session.sessionId,
      configId,
      ...(typeof value === 'boolean' ? { type: 'boolean' as const, value } : { value }),
    });
    configOptions = response.configOptions;
  };
  return {
    options: all,
    adopt(options) {
      configOptions = [...options];
    },
    adoptMode(mode) {
      noteLegacyMode(mode);
      const modes = findOption(configOptions, 'mode');
      configOptions = configOptions.map((option) =>
        option === modes && option.type === 'select' ? { ...option, currentValue: mode } : option,
      );
    },
    setValue,
    leaveUnpinned(model) {
      unpinned = model;
    },
    unpinnedModel: () => unpinned,
    async setMode(mode) {
      const option = findOption(all(), 'mode');
      if (!option) throw new ProviderError('The agent has no modes.');
      if (option.currentValue === mode) return;
      if (option.id === LEGACY_MODE_OPTION) await setLegacyMode(mode);
      else await setValue(option.id, mode);
    },
  };
}

function valueFits(option: acp.SessionConfigOption, value: string | boolean): boolean {
  if (option.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && choices(option).some((choice) => choice.value === value);
}

export async function applySessionSettings(
  ctx: Requester,
  session: SessionHandle,
  definition: AgentDefinition,
  settings: AgentSettings,
  mode: ModeWish = { wanted: definition.conversationMode },
  resumed = false,
  kept: SettingsSession | null = null,
): Promise<AppliedSettings> {
  const initial = withLegacy(
    session.newSessionResponse.configOptions ?? [],
    legacyOptions(session.newSessionResponse),
  );
  const live = kept ?? settingsSession(ctx, session);
  const notes: string[] = mode.note ? [mode.note] : [];
  const defaultNote = (wish: ConfigWish, reason: string) =>
    `Using ${definition.name}'s default ${wish.category === 'model' ? 'model' : 'effort'}; ${wish.label ?? wish.value} ${reason}`;

  const chosenMode = offersMode(live.options(), mode.wanted)
    ? mode.wanted
    : mode.fallback && offersMode(live.options(), mode.fallback)
      ? mode.fallback
      : null;
  if (chosenMode === null) {
    throw new ProviderError(
      `${definition.name} could not switch to the ${mode.wanted} mode, so the run was stopped before it started.`,
    );
  }
  if (chosenMode !== mode.wanted) {
    notes.push(
      `${definition.name} doesn't offer ${mode.wanted} here; using ${modeName(live.options(), chosenMode)}`,
    );
  }
  await live.setMode(chosenMode);
  assertModeInForce(live.options(), chosenMode, definition.name);
  notes.push(
    ...(await applyPlanning(live, mode.plan === true, settings.options ?? {}, definition.name)),
  );

  const wishes: ConfigWish[] = [
    { category: 'model', value: settings.model, label: settings.modelLabel },
    { category: 'thought_level', value: settings.effort },
  ];
  for (const wish of wishes) {
    const plan = planConfig(live.options(), [wish], resumed && reasserted(live.options(), wish));
    if (plan.unmatched.length > 0) {
      if (await resolvedByAgent(live, definition, wish)) continue;
      notes.push(defaultNote(wish, "isn't offered by the agent"));
      if (wish.category === 'model') live.leaveUnpinned(wish.label ?? wish.value ?? '');
      continue;
    }
    for (const change of plan.changes) await applyChange(live, wish, change, notes, defaultNote);
  }
  for (const [configId, value] of Object.entries(settings.options ?? {})) {
    const option = live.options().find((candidate) => candidate.id === configId);
    if (!option || isCoreOption(live.options(), option) || !valueFits(option, value)) {
      notes.push(
        `${definition.name} no longer offers the ${configId} setting you chose; skipped it`,
      );
      continue;
    }
    if (option.currentValue !== value) await live.setValue(configId, value);
  }
  const options = live.options();
  return {
    notes,
    options,
    capabilities: {
      ...capabilitiesFrom(options, initial),
      access: reportedAccess(definition, initial),
    },
    mode: currentValue(options, 'mode'),
    current: {
      model: currentValue(options, 'model'),
      effort: currentValue(options, 'thought_level'),
    },
    values: currentValues(options),
    using: usingLabel(options, definition.name),
    live,
  };
}

async function resolvedByAgent(
  live: SettingsSession,
  definition: AgentDefinition,
  wish: ConfigWish,
): Promise<boolean> {
  const option = findOption(live.options(), wish.category);
  if (!definition.resolvesModelNames || wish.category !== 'model' || wish.value === null) {
    return false;
  }
  if (!option || option.id === LEGACY_MODEL_OPTION) return false;
  try {
    await live.setValue(option.id, wish.value);
    return true;
  } catch {
    return false;
  }
}

function reasserted(options: readonly acp.SessionConfigOption[], wish: ConfigWish): boolean {
  const option = findOption(options, wish.category);
  return wish.category === 'model' && option !== undefined && option.id !== LEGACY_MODEL_OPTION;
}

function assertModeInForce(
  options: readonly acp.SessionConfigOption[],
  wanted: string,
  agentName: string,
): void {
  const inForce = currentValue(options, 'mode');
  if (inForce === wanted) return;
  throw new ProviderError(
    `${agentName} stayed in ${modeName(options, inForce ?? 'an unknown')} mode instead of ${modeName(options, wanted)}, so the run was stopped before it started.`,
  );
}

function collaborationOption(
  options: readonly acp.SessionConfigOption[],
): acp.SessionConfigOption | undefined {
  return options.find(
    (option) =>
      option.type === 'select' &&
      option.category === COLLABORATION_CATEGORY &&
      choices(option).some((choice) => choice.value === PLAN_MODE_ID),
  );
}

async function applyPlanning(
  live: SettingsSession,
  plan: boolean,
  chosen: ConfigValues,
  agentName: string,
): Promise<string[]> {
  if (plan && offersMode(live.options(), PLAN_MODE_ID)) {
    await live.setMode(PLAN_MODE_ID);
    return [];
  }
  const collaboration = collaborationOption(live.options());
  if (!collaboration) {
    return plan ? [`${agentName} has no plan mode here; it plans in its read-only mode`] : [];
  }
  if (!plan && collaboration.id in chosen) return [];
  const wanted = plan
    ? PLAN_MODE_ID
    : choices(collaboration).find((choice) => choice.value !== PLAN_MODE_ID)?.value;
  if (wanted && collaboration.currentValue !== wanted)
    await live.setValue(collaboration.id, wanted);
  return [];
}

async function applyChange(
  live: SettingsSession,
  wish: ConfigWish,
  change: ConfigChange,
  notes: string[],
  defaultNote: (wish: ConfigWish, reason: string) => string,
): Promise<void> {
  if (change.configId === LEGACY_MODEL_OPTION) {
    notes.push(defaultNote(wish, "can't be selected with this agent"));
    return;
  }
  await live.setValue(change.configId, change.value);
}

export async function applySettings(
  ctx: Requester,
  session: SessionHandle,
  definition: AgentDefinition,
  settings: AgentSettings,
): Promise<string[]> {
  const applied = await applySessionSettings(ctx, session, definition, settings);
  return applied.notes;
}
