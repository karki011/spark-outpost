import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable';
import { choices, findOption } from './session-config.ts';

export function codexUnlistedModels(options: readonly SessionConfigOption[]): string[] {
  const option = findOption(options, 'model');
  if (!option) return [];
  const offered = choices(option);
  if (offered.every((choice) => choice.description === null)) return [];
  return offered
    .filter((choice) => choice.value === option.currentValue && choice.description === null)
    .map((choice) => choice.value);
}
