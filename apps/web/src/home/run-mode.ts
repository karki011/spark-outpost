import {
  defaultModeFor,
  providerIdSchema,
  type ConversationSummary,
  type ProviderCapabilities,
  type ProviderId,
} from '@spark-outpost/contracts';
import { modePermission } from '../chat/composer/mode-summary.ts';
import type { RunItem } from './home-model.ts';

export type ModeGroup = 'ask' | 'free' | 'other';

export interface RunMode {
  group: ModeGroup;
  label: string;
}

export type CapabilitiesByProvider = ReadonlyMap<ProviderId, ProviderCapabilities>;

const GROUP_LINE = {
  ask: 'will stop and ask',
  free: 'runs without asking',
} as const;

export function runProvider(chat: ConversationSummary): ProviderId | null {
  return providerIdSchema.safeParse(chat.latestRun?.provider).data ?? null;
}

export function runMode(
  chat: ConversationSummary,
  capabilities: CapabilitiesByProvider,
): RunMode | null {
  const provider = runProvider(chat);
  const caps = provider ? capabilities.get(provider) : undefined;
  if (!provider || !caps) return null;
  const mode = chat.latestRun?.agentMode ?? caps.defaultMode ?? defaultModeFor(provider);
  const state = modePermission(provider, mode, caps);
  if (state.risk === 'read') return { group: 'other', label: `${state.short} · read only` };
  const group = state.risk === 'ask' || state.risk === 'edit' ? 'ask' : 'free';
  return { group, label: `${state.short} · ${GROUP_LINE[group]}` };
}

export interface RunGroup {
  key: ModeGroup;
  title: string;
  items: RunItem[];
}

const GROUP_ORDER: readonly { key: ModeGroup; title: string }[] = [
  { key: 'ask', title: 'Will stop and ask' },
  { key: 'free', title: 'Runs without asking' },
  { key: 'other', title: 'Still working' },
];

export function groupRunning(
  items: readonly RunItem[],
  capabilities: CapabilitiesByProvider,
): RunGroup[] {
  const grouped = new Map<ModeGroup, RunItem[]>();
  for (const item of items) {
    const group = runMode(item.chat, capabilities)?.group ?? 'other';
    grouped.set(group, [...(grouped.get(group) ?? []), item]);
  }
  return GROUP_ORDER.flatMap(({ key, title }) => {
    const found = grouped.get(key);
    return found ? [{ key, title, items: found }] : [];
  });
}
