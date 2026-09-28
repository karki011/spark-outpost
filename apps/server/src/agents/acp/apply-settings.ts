import * as acp from '@agentclientprotocol/sdk';
import type { ConfigValues } from '@spark-outpost/contracts';
import {
  ProviderError,
  type AgentSettings,
  type ProviderCapabilityReport,
} from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { capabilitiesFrom, isCoreOption } from './capabilities.ts';
import {
  LEGACY_MODE_OPTION,
  LEGACY_MODEL_OPTION,
  legacyOptions,
  withLegacy,
} from './legacy-options.ts';
import {
  choices,
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
}

export interface ModeWish {
  wanted: string;
  fallback?: string;
  note?: string;
}

type Requester = Pick<acp.ClientContext, 'request'>;
type SessionHandle = Pick<acp.ActiveSession, 'sessionId' | 'newSessionResponse'>;

function currentName(options: readonly acp.SessionConfigOption[], category: string) {
  const option = findOption(options, category);
  if (!option || typeof option.currentValue !== 'string') return null;
  const value = option.currentValue;
  return choices(option).find((choice) => choice.value === value)?.name ?? value;
}

export function usingLabel(options: readonly acp.SessionConfigOption[], agentName: string): string {
  const model = currentName(options, 'model');
  const effort = currentName(options, 'thought_level');
  const parts = [model, effort && `${effort.toLowerCase()} effort`].filter(Boolean);
  return parts.length > 0 ? `Using ${parts.join(' · ')}` : `Using ${agentName}'s defaults`;
}

function currentValue(
  options: readonly acp.SessionConfigOption[],
  category: string,
): string | null {
  const option = findOption(options, category);
  return option && typeof option.currentValue === 'string' ? option.currentValue : null;
}

export function currentValues(options: readonly acp.SessionConfigOption[]): ConfigValues {
  return Object.fromEntries(
    options
      .filter((option) => !isCoreOption(options, option))
      .map((option) => [option.id, option.currentValue]),
  );
}

export function modeName(options: readonly acp.SessionConfigOption[], mode: string): string {
  const option = findOption(options, 'mode');
  return (option && choices(option).find((choice) => choice.value === mode)?.name) ?? mode;
}

export function offersMode(options: readonly acp.SessionConfigOption[], mode: string): boolean {
  const option = findOption(options, 'mode');
  return option !== undefined && choices(option).some((choice) => choice.value === mode);
}

export interface SettingsSession {
  options(): acp.SessionConfigOption[];
  adopt(options: readonly acp.SessionConfigOption[]): void;
  setMode(mode: string): Promise<void>;
  setValue(configId: string, value: string | boolean): Promise<void>;
}

export function settingsSession(
  ctx: Requester,
  session: SessionHandle,
  initial: readonly acp.SessionConfigOption[] = session.newSessionResponse.configOptions ?? [],
): SettingsSession {
  let configOptions = [...initial];
  let legacy = legacyOptions(session.newSessionResponse);
  const all = () => withLegacy(configOptions, legacy);
  const setLegacyMode = async (mode: string) => {
    await ctx.request(acp.methods.agent.session.setMode, {
      sessionId: session.sessionId,
      modeId: mode,
    });
    legacy = legacy.map((option) =>
      option.id === LEGACY_MODE_OPTION && option.type === 'select'
        ? { ...option, currentValue: mode }
        : option,
    );
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
    setValue,
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
): Promise<AppliedSettings> {
  const initial = withLegacy(
    session.newSessionResponse.configOptions ?? [],
    legacyOptions(session.newSessionResponse),
  );
  const live = settingsSession(ctx, session);
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

  const wishes: ConfigWish[] = [
    { category: 'model', value: settings.model, label: settings.modelLabel },
    { category: 'thought_level', value: settings.effort },
  ];
  for (const wish of wishes) {
    const plan = planConfig(live.options(), [wish]);
    if (plan.unmatched.length > 0) {
      notes.push(defaultNote(wish, "isn't offered by the agent"));
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
    capabilities: capabilitiesFrom(options, initial),
    mode: currentValue(options, 'mode'),
    current: {
      model: currentValue(options, 'model'),
      effort: currentValue(options, 'thought_level'),
    },
    values: currentValues(options),
    using: usingLabel(options, definition.name),
  };
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
