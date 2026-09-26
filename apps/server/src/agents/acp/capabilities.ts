import type { NewSessionResponse, SessionConfigOption } from '@agentclientprotocol/sdk';
import type { CapabilityChoice, ProviderCapabilityReport } from '../../providers/provider.ts';
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

function currentModel(options: readonly SessionConfigOption[]): string | null {
  const model = optionsFor(options, 'model');
  return model && typeof model.currentValue === 'string' ? model.currentValue : null;
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
  };
}

export function sessionCapabilities(response: NewSessionResponse): ProviderCapabilityReport {
  return capabilitiesFrom(sessionOptions(response));
}
