import {
  DEFAULT_INVOLVEMENT_LEVEL,
  autonomyLabel,
  defaultModeFor,
  isReadOnlyPosture,
  modeKind,
  modePosture,
  type AgentModeOption,
  type ChatSettings,
  type InvolvementLevel,
  type ModePosture,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';

export type PermissionRisk = 'read' | 'ask' | 'edit' | 'auto' | 'full';

export interface PermissionState {
  mode: string | null;
  label: string;
  short: string;
  risk: PermissionRisk;
  description: string | null;
}

const RISKS: Readonly<Record<ModePosture, PermissionRisk>> = {
  read_only: 'read',
  asks: 'ask',
  denies: 'ask',
  edits: 'edit',
  auto: 'auto',
  full_access: 'full',
  unknown: 'auto',
};

const SHORT_LABELS: Readonly<Record<string, string>> = {
  'Bypass permissions': 'Bypass',
};

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

export function modePermission(
  provider: string | null,
  mode: string | null,
  capabilities: ProviderCapabilities | undefined,
): PermissionState {
  const modes = capabilities?.modes ?? [];
  const label = modeLabel(modes, mode);
  const posture = modePosture(provider, mode, modeKind(modes, mode));
  return {
    mode,
    label,
    short: SHORT_LABELS[label] ?? label,
    risk: RISKS[posture],
    description: modes.find((option) => option.id === mode)?.description ?? null,
  };
}

export function permissionState(
  settings: ChatSettings,
  capabilities: ProviderCapabilities | undefined,
): PermissionState {
  const mode = settings.agentMode ?? capabilities?.defaultMode ?? defaultModeFor(settings.provider);
  return modePermission(settings.provider, mode, capabilities);
}

export function withCurrentMode(
  modes: readonly AgentModeOption[],
  current: string | null,
): AgentModeOption[] {
  if (!current || modes.some((mode) => mode.id === current)) return [...modes];
  return [...modes, { id: current, label: current, description: null, kind: null }];
}

export const NO_PROJECT_TOOLS = 'No file tools without a project';
export const NO_PROJECT_NOTE =
  'Without a project the agent can’t read or change files or run commands. Your mode still decides whether Spark’s own tools ask first.';

export function projectPermission(state: PermissionState, hasRepos: boolean): PermissionState {
  if (hasRepos) return state;
  return {
    ...state,
    label: NO_PROJECT_TOOLS,
    short: NO_PROJECT_TOOLS,
    description: NO_PROJECT_NOTE,
  };
}
