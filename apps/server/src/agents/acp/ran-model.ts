import type { SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk';
import type { ModelCard } from '@spark-outpost/contracts';
import { cardFor } from '../../model-cards/cards.ts';
import type { ProviderOutput } from '../../providers/provider.ts';
import type { SettingsSession } from './apply-settings.ts';
import { currentValues } from './capabilities.ts';
import { reportedModel } from './long-context.ts';
import { choices, currentValue, findOption } from './session-config.ts';

export interface RanModelWatch {
  see(update: SessionUpdate): ProviderOutput[];
}

function optionFor(
  options: readonly SessionConfigOption[],
  card: ModelCard,
  provider: string,
): string | null {
  const option = findOption(options, 'model');
  const offered = option ? choices(option) : [];
  const match = offered.find((choice) => cardFor({ id: choice.value }, provider)?.id === card.id);
  return match?.value ?? null;
}

export function watchRanModel(
  provider: string,
  agentName: string,
  live: Pick<SettingsSession, 'options'>,
  note: (name: string) => ProviderOutput[],
): RanModelWatch {
  let noted: string | null = null;
  return {
    see(update) {
      if (update.sessionUpdate !== 'usage_update') return [];
      const ran = reportedModel(update._meta);
      const options = live.options();
      const reported = currentValue(options, 'model');
      if (!ran || !reported || ran === noted) return [];
      const ranCard = cardFor({ id: ran }, provider);
      const reportedCard = cardFor({ id: reported }, provider);
      if (!ranCard || !reportedCard || ranCard.id === reportedCard.id) return [];
      noted = ran;
      return [
        {
          kind: 'session_settings',
          model: optionFor(options, ranCard, provider) ?? ran,
          effort: currentValue(options, 'thought_level'),
          mode: currentValue(options, 'mode'),
          options: currentValues(options),
        },
        ...note(`${agentName} ran this turn on ${ranCard.label}, not ${reportedCard.label}`),
      ];
    },
  };
}
