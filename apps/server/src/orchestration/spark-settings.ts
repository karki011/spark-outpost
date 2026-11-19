import { translateMode, type SparkSettingFrom } from '@spark-outpost/contracts';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';

export interface InheritedPlace {
  provider: string;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
  usable: (provider: string) => boolean;
  inChat: boolean;
  appliesOwnMode: boolean;
}

export interface SparkRunSettings {
  provider: string;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
  agentFrom: SparkSettingFrom;
  modeFrom: SparkSettingFrom;
}

type SparkChoices = Pick<
  MentionableSpark,
  'provider' | 'model' | 'effort' | 'agentMode' | 'connected'
>;

function ownAgent(place: InheritedPlace, spark: SparkChoices): string | null {
  if (spark.provider === null) return null;
  if (spark.provider === place.provider) return spark.provider;
  return spark.connected && place.usable(spark.provider) ? spark.provider : null;
}

export function sparkRunSettings(place: InheritedPlace, spark: SparkChoices): SparkRunSettings {
  const inherited: SparkSettingFrom = place.inChat ? 'chat' : 'default';
  const own = ownAgent(place, spark);
  const provider = own ?? place.provider;
  const sameAgent = provider === place.provider;
  const model = own ? (spark.model ?? (sameAgent ? place.model : null)) : place.model;
  const effort = own ? (spark.effort ?? (sameAgent ? place.effort : null)) : place.effort;
  const ownMode = own !== null && place.appliesOwnMode ? spark.agentMode : null;
  return {
    provider,
    model,
    effort,
    agentMode: ownMode ?? translateMode(place.provider, place.agentMode, provider),
    agentFrom: own ? 'spark' : inherited,
    modeFrom: ownMode ? 'spark' : inherited,
  };
}
