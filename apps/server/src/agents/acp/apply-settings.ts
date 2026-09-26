import * as acp from '@agentclientprotocol/sdk';
import {
  ProviderError,
  type AgentSettings,
  type ProviderCapabilityReport,
} from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { capabilitiesFrom } from './capabilities.ts';
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
  using: string;
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

export async function applySessionSettings(
  ctx: Requester,
  session: SessionHandle,
  definition: AgentDefinition,
  settings: AgentSettings,
): Promise<AppliedSettings> {
  let configOptions = session.newSessionResponse.configOptions ?? [];
  let legacy = legacyOptions(session.newSessionResponse);
  const initial = withLegacy(configOptions, legacy);
  let options = initial;
  const notes: string[] = [];
  const wishes: ConfigWish[] = [
    { category: 'mode', value: definition.conversationMode },
    { category: 'model', value: settings.model, label: settings.modelLabel },
    { category: 'thought_level', value: settings.effort },
  ];
  const defaultNote = (wish: ConfigWish, reason: string) =>
    `Using ${definition.name}'s default ${wish.category === 'model' ? 'model' : 'effort'}; ${wish.label ?? wish.value} ${reason}`;

  const apply = async (wish: ConfigWish, change: ConfigChange) => {
    if (change.configId === LEGACY_MODEL_OPTION) {
      notes.push(defaultNote(wish, "can't be selected with this agent"));
      return;
    }
    if (change.configId === LEGACY_MODE_OPTION) {
      await ctx.request(acp.methods.agent.session.setMode, {
        sessionId: session.sessionId,
        modeId: change.value,
      });
      legacy = legacy.map((option) =>
        option.id === change.configId && option.type === 'select'
          ? { ...option, currentValue: change.value }
          : option,
      );
    } else {
      const response = await ctx.request(acp.methods.agent.session.setConfigOption, {
        sessionId: session.sessionId,
        configId: change.configId,
        value: change.value,
      });
      configOptions = response.configOptions;
    }
    options = withLegacy(configOptions, legacy);
  };

  for (const wish of wishes) {
    const plan = planConfig(options, [wish]);
    if (plan.unmatched.length > 0) {
      if (wish.category === 'mode') {
        throw new ProviderError(
          `${definition.name} could not switch to its safe chat mode, so the run was stopped before it started.`,
        );
      }
      notes.push(defaultNote(wish, "isn't offered by the agent"));
      continue;
    }
    for (const change of plan.changes) await apply(wish, change);
  }
  return {
    notes,
    options,
    capabilities: capabilitiesFrom(options, initial),
    mode: currentValue(options, 'mode'),
    current: {
      model: currentValue(options, 'model'),
      effort: currentValue(options, 'thought_level'),
    },
    using: usingLabel(options, definition.name),
  };
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
