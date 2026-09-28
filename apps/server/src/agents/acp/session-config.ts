import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from '@agentclientprotocol/sdk';

export interface ConfigWish {
  category: string;
  value: string | null;
  label?: string | null;
}

export interface ConfigChange {
  configId: string;
  value: string;
}

export interface ConfigPlan {
  changes: ConfigChange[];
  unmatched: ConfigWish[];
}

export interface Choice {
  value: string;
  name: string;
  description: string | null;
  kind: string | null;
  group: string | null;
}

const metaKind = (meta: unknown): string | null => {
  const kind =
    meta !== null && typeof meta === 'object' ? (meta as { kind?: unknown }).kind : undefined;
  return typeof kind === 'string' ? kind : null;
};

function choiceOf(entry: SessionConfigSelectOption, group: string | null): Choice {
  return {
    value: entry.value,
    name: entry.name,
    description: entry.description ?? null,
    kind: metaKind(entry._meta),
    group,
  };
}

export function choices(option: SessionConfigOption): Choice[] {
  if (option.type !== 'select') return [];
  const entries: (SessionConfigSelectOption | SessionConfigSelectGroup)[] = option.options;
  return entries.flatMap((entry) =>
    'value' in entry
      ? [choiceOf(entry, null)]
      : entry.options.map((inner) => choiceOf(inner, entry.name)),
  );
}

const normalize = (text: string) => text.trim().toLowerCase();

function pick(option: SessionConfigOption, wish: ConfigWish): string | null {
  const available = choices(option);
  const wanted = wish.value ? normalize(wish.value) : null;
  const label = wish.label ? normalize(wish.label) : null;
  const match =
    available.find((choice) => wanted !== null && normalize(choice.value) === wanted) ??
    available.find((choice) => label !== null && normalize(choice.name) === label);
  return match?.value ?? null;
}

const FALLBACK_IDS: Record<string, readonly string[]> = {
  mode: ['mode'],
  model: ['model'],
  thought_level: ['thought_level', 'reasoning_effort', 'effort'],
};

export function findOption<T extends { id: string; category?: string | null }>(
  options: readonly T[],
  category: string,
): T | undefined {
  return (
    options.find((option) => option.category === category) ??
    options.find((option) => !option.category && FALLBACK_IDS[category]?.includes(option.id))
  );
}

export function planConfig(
  options: readonly SessionConfigOption[],
  wishes: ConfigWish[],
): ConfigPlan {
  const plan: ConfigPlan = { changes: [], unmatched: [] };
  for (const wish of wishes) {
    if (wish.value === null) continue;
    const option = findOption(options, wish.category);
    const value = option ? pick(option, wish) : null;
    if (!option || value === null) {
      plan.unmatched.push(wish);
      continue;
    }
    if (option.currentValue !== value) plan.changes.push({ configId: option.id, value });
  }
  return plan;
}
