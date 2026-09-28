import {
  isRetiring,
  type CapabilityOption,
  type ChatSettings,
  type ModelOption,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';

export const AGENT_DEFAULT = 'default';

export function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '').trim() || label;
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
  if (!model.retiresNotBefore || !isRetiring(model, now)) return null;
  const date = new Date(`${model.retiresNotBefore}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `Retiring ${date}`;
}

export function visibleModels(
  models: readonly ModelOption[],
  selected: string | null,
  showRetiring: boolean,
  now: Date,
): ModelOption[] {
  if (showRetiring) return [...models];
  return models.filter((model) => model.id === selected || !isRetiring(model, now));
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

export type ContextLevel = 'ok' | 'warm' | 'hot';

export function contextLevel(percent: number): ContextLevel {
  if (percent >= 85) return 'hot';
  if (percent >= 60) return 'warm';
  return 'ok';
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  const thousands = count / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}K`;
}
