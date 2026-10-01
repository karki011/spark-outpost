import {
  DEFAULT_INVOLVEMENT_LEVEL,
  autonomyLabel,
  isReadOnlyPosture,
  modePosture,
  type AgentModeOption,
  type ChatSettings,
  type InvolvementLevel,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';

export function modeLabel(modes: readonly AgentModeOption[], mode: string | null): string {
  if (!mode) return 'Default mode';
  return modes.find((option) => option.id === mode)?.label ?? mode;
}

export function modeSummary(
  provider: string | null,
  mode: string | null,
  level: InvolvementLevel | null,
  modes: readonly AgentModeOption[],
): string {
  const label = modeLabel(modes, mode);
  const kind = modes.find((option) => option.id === mode)?.kind ?? null;
  if (isReadOnlyPosture(modePosture(provider, mode, kind))) return label;
  return `${label} · ${autonomyLabel(level ?? DEFAULT_INVOLVEMENT_LEVEL)}`;
}

export function permissionSummary(
  settings: ChatSettings,
  capabilities: ProviderCapabilities | undefined,
): string {
  return modeLabel(capabilities?.modes ?? [], settings.agentMode);
}

export function withCurrentMode(
  modes: readonly AgentModeOption[],
  current: string | null,
): AgentModeOption[] {
  if (!current || modes.some((mode) => mode.id === current)) return [...modes];
  return [...modes, { id: current, label: current, description: null, kind: null }];
}
