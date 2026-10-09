import {
  isRetiring,
  retirementState,
  shortModelLabel,
  unavailableText,
  type ModelRef,
  type CapabilityOption,
  type ChatSettings,
  type ModelOption,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';

export const AGENT_DEFAULT = 'default';

export function shortLabel(label: string): string {
  return shortModelLabel(label);
}

export function cleanDescription(option: CapabilityOption): string | null {
  const description = option.description?.trim();
  if (!description) return null;
  const parts = description.split(' · ');
  const first = parts[0] ?? '';
  const name = shortLabel(option.label).toLowerCase();
  if (parts.length > 1 && first.toLowerCase().startsWith(name)) return parts.slice(1).join(' · ');
  return description;
}

export function buttonLabel(option: CapabilityOption): string {
  const described = option.description?.split('·')[0]?.trim();
  if (option.id === AGENT_DEFAULT && described) return shortLabel(described);
  return shortLabel(option.label);
}

export function optionLabel(
  option: Pick<CapabilityOption, 'id' | 'label'>,
  capabilities: Pick<ProviderCapabilities, 'defaultModel'> | undefined,
): string {
  const marked = option.id !== AGENT_DEFAULT && option.id === capabilities?.defaultModel;
  return marked ? `${option.label} (default)` : option.label;
}

export function retiringLabel(model: ModelOption, now: Date): string | null {
  const state = retirementState(model, now);
  if (!state) return null;
  const word = state === 'retired' ? 'Retired' : 'Retiring';
  if (!model.retiresNotBefore) return word;
  const date = new Date(`${model.retiresNotBefore}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${word} ${date}`;
}

export function visibleModels(
  models: readonly ModelOption[],
  selected: string | null,
  showRetiring: boolean,
  now: Date,
): ModelOption[] {
  const usable = models.filter(
    (model) => model.id === selected || model.availability !== 'unusable',
  );
  if (showRetiring) return usable;
  return usable.filter((model) => model.id === selected || !isRetiring(model, now));
}

export function availabilityTag(
  model: Pick<ModelOption, 'availability'>,
  capabilities: Pick<ProviderCapabilities, 'access'> | undefined,
): string | null {
  if (model.availability === 'unusable') return 'Unavailable';
  const reported = capabilities?.access?.reported === true;
  return reported && model.availability === 'unknown' ? 'Unconfirmed' : null;
}

export interface UnusableChoice {
  text: string;
  switchTo: ModelRef | null;
}

export function unusableChoice(
  selected: string | null,
  capabilities: ProviderCapabilities | undefined,
): UnusableChoice | null {
  const model = capabilities?.models.find((option) => option.id === selected);
  if (!model || model.availability !== 'unusable' || !capabilities?.access) return null;
  return {
    text: unavailableText(capabilities.access.signIn, shortLabel(model.label)),
    switchTo: model.switchTo ?? null,
  };
}

export function selectableEfforts(
  capabilities: ProviderCapabilities | undefined,
): CapabilityOption[] {
  return (capabilities?.efforts ?? []).filter((effort) => effort.id !== AGENT_DEFAULT);
}

export function currentModel(
  settings: ChatSettings,
  capabilities: ProviderCapabilities | undefined,
): CapabilityOption | null {
  const models = capabilities?.models ?? [];
  const find = (id: string | null | undefined) => models.find((model) => model.id === id);
  return find(settings.model) ?? find(capabilities?.defaultModel) ?? null;
}

const EFFORT_NOTES: Record<string, string> = {
  minimal: 'Answers right away',
  low: 'Quick replies, light reasoning',
  medium: 'Balanced for most tasks',
  high: 'Thinks longer on hard problems',
  xhigh: 'Extra depth for tricky work',
  max: 'Deepest reasoning, slowest replies',
  ultra: 'Maximum reasoning, may delegate tasks',
};

export function effortNote(effort: CapabilityOption): string | null {
  return effort.description ?? EFFORT_NOTES[effort.id] ?? null;
}

export function meterLevel(efforts: CapabilityOption[], effort: string | null, bars = 4): number {
  const index = efforts.findIndex((option) => option.id === effort);
  if (index < 0 || efforts.length === 0) return 0;
  return Math.max(1, Math.round(((index + 1) / efforts.length) * bars));
}

const trimZero = (value: string) => value.replace(/\.0$/, '');

export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  const thousands = count / 1000;
  if (thousands < 100) return `${trimZero(thousands.toFixed(1))}K`;
  if (Math.round(thousands) < 1000) return `${Math.round(thousands)}K`;
  return `${trimZero((count / 1_000_000).toFixed(1))}M`;
}
