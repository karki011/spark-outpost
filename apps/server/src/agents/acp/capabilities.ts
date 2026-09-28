import type { NewSessionResponse, SessionConfigOption } from '@agentclientprotocol/sdk';
import type { AgentModeOption, ConfigOptionInfo } from '@spark-outpost/contracts';
import type { CapabilityChoice, ProviderCapabilityReport } from '../../providers/provider.ts';
import type { AgentOffers } from './agents.ts';
import { sessionOptions } from './legacy-options.ts';
import { choices, findOption } from './session-config.ts';

function optionsFor(options: readonly SessionConfigOption[], category: string) {
  return findOption(options, category);
}

function toChoices(option: SessionConfigOption | undefined): CapabilityChoice[] {
  if (!option) return [];
  return choices(option).map((choice) => ({
    id: choice.value,
    label: choice.name,
    description: choice.description,
  }));
}

const LEGACY = /^(older|legacy|deprecated)\b/i;

export function isLegacy(choice: CapabilityChoice): boolean {
  return LEGACY.test(choice.description?.trim() ?? '');
}

function currentOf(options: readonly SessionConfigOption[], category: string): string | null {
  const option = optionsFor(options, category);
  return option && typeof option.currentValue === 'string' ? option.currentValue : null;
}

function currentModel(options: readonly SessionConfigOption[]): string | null {
  return currentOf(options, 'model');
}

export function modesFrom(options: readonly SessionConfigOption[]): AgentModeOption[] {
  const mode = optionsFor(options, 'mode');
  if (!mode) return [];
  return choices(mode).map((choice) => ({
    id: choice.value,
    label: choice.name,
    description: choice.description,
    kind: choice.kind,
  }));
}

export const CORE_CATEGORIES = ['mode', 'model', 'thought_level'] as const;

export function isCoreOption(
  options: readonly SessionConfigOption[],
  option: SessionConfigOption,
): boolean {
  return CORE_CATEGORIES.some((category) => findOption(options, category) === option);
}

export function configInfo(option: SessionConfigOption): ConfigOptionInfo {
  const base = {
    id: option.id,
    name: option.name,
    description: option.description ?? null,
    category: option.category ?? null,
  };
  if (option.type === 'boolean') {
    return { ...base, type: 'boolean', currentValue: option.currentValue };
  }
  return {
    ...base,
    type: 'select',
    currentValue: option.currentValue,
    choices: choices(option).map((choice) => ({
      id: choice.value,
      label: choice.name,
      description: choice.description,
      group: choice.group,
    })),
  };
}

export function extraOptions(options: readonly SessionConfigOption[]): ConfigOptionInfo[] {
  return options
    .filter((option) => !isCoreOption(options, option))
    .filter((option) => option.type === 'boolean' || option.type === 'select')
    .map(configInfo);
}

export function capabilitiesFrom(
  options: readonly SessionConfigOption[],
  defaultsFrom: readonly SessionConfigOption[] = options,
): ProviderCapabilityReport {
  const current = currentModel(defaultsFrom);
  const models = toChoices(optionsFor(options, 'model')).filter((choice) => !isLegacy(choice));
  return {
    models,
    efforts: toChoices(optionsFor(options, 'thought_level')),
    defaultModel: models.some((choice) => choice.id === current)
      ? current
      : (models[0]?.id ?? null),
    modes: modesFrom(options),
    defaultMode: currentOf(defaultsFrom, 'mode'),
    options: extraOptions(defaultsFrom),
  };
}

export function sessionCapabilities(response: NewSessionResponse): ProviderCapabilityReport {
  return capabilitiesFrom(sessionOptions(response));
}

export function offeredCapabilities(
  report: ProviderCapabilityReport,
  offers: AgentOffers | undefined,
): ProviderCapabilityReport {
  if (!offers) return report;
  const models = report.models.filter((choice) => offers.models.includes(choice.id));
  const efforts = report.efforts.filter((choice) => offers.efforts.includes(choice.id));
  return {
    ...report,
    models,
    efforts,
    defaultModel: models.some((choice) => choice.id === report.defaultModel)
      ? report.defaultModel
      : (models[0]?.id ?? null),
  };
}
