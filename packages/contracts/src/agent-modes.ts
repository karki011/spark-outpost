import { z } from 'zod';
import { PERMISSION_ASK, PERMISSION_DO } from './approvals.ts';
import type { InvolvementLevel } from './involvement-levels.ts';

export const agentModeOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  kind: z.string().nullable().default(null),
});
export type AgentModeOption = z.infer<typeof agentModeOptionSchema>;

export const configChoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  group: z.string().nullable().default(null),
});
export type ConfigChoice = z.infer<typeof configChoiceSchema>;

export const configOptionInfoSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('select'),
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    currentValue: z.string(),
    choices: z.array(configChoiceSchema),
  }),
  z.object({
    type: z.literal('boolean'),
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    currentValue: z.boolean(),
  }),
]);
export type ConfigOptionInfo = z.infer<typeof configOptionInfoSchema>;

export const configValueSchema = z.union([z.string().min(1).max(200), z.boolean()]);
export type ConfigValue = z.infer<typeof configValueSchema>;

export const CONFIG_VALUES_MAX = 20;

export const configValuesSchema = z
  .record(z.string().min(1).max(200), configValueSchema)
  .refine((values) => Object.keys(values).length <= CONFIG_VALUES_MAX, 'Too many options.');
export type ConfigValues = z.infer<typeof configValuesSchema>;

export const MODE_POSTURES = [
  'read_only',
  'asks',
  'edits',
  'auto',
  'denies',
  'full_access',
  'unknown',
] as const;
export type ModePosture = (typeof MODE_POSTURES)[number];

export interface ProviderModeTable {
  defaultMode: string;
  readOnlyMode: string;
  askingMode: string;
  postures: Readonly<Record<string, ModePosture>>;
  skipsGate: readonly string[];
}

const CLAUDE_MODES: ProviderModeTable = {
  defaultMode: 'auto',
  readOnlyMode: 'plan',
  askingMode: 'default',
  postures: {
    plan: 'read_only',
    default: 'asks',
    acceptEdits: 'edits',
    auto: 'auto',
    dontAsk: 'denies',
    bypassPermissions: 'full_access',
  },
  skipsGate: ['bypassPermissions'],
};

const ZAI_MODES: ProviderModeTable = { ...CLAUDE_MODES, defaultMode: 'default' };

const CODEX_MODES: ProviderModeTable = {
  defaultMode: 'agent',
  readOnlyMode: 'read-only',
  askingMode: 'ask-every-action',
  postures: {
    'read-only': 'read_only',
    'ask-every-action': 'asks',
    agent: 'auto',
    'agent-full-access': 'full_access',
  },
  skipsGate: ['agent', 'agent-full-access'],
};

const PROVIDER_MODES: Readonly<Record<string, ProviderModeTable>> = {
  claude: CLAUDE_MODES,
  zai: ZAI_MODES,
  codex: CODEX_MODES,
};

function providerModes(provider: string | null): ProviderModeTable | null {
  return provider ? (PROVIDER_MODES[provider] ?? null) : null;
}

const KIND_POSTURES: Readonly<Record<string, ModePosture>> = {
  plan: 'read_only',
  read_only: 'read_only',
  auto_review: 'auto',
  full_access: 'full_access',
};

const READ_ONLY_ID = /^(read-?only|plan)$/i;

function knownPosture(provider: string | null, mode: string): ModePosture | undefined {
  const table = providerModes(provider);
  if (table) return table.postures[mode];
  return Object.values(PROVIDER_MODES).find((other) => other.postures[mode])?.postures[mode];
}

export function providerModeIds(provider: string | null): string[] {
  return Object.keys(providerModes(provider)?.postures ?? {});
}

export function modePosture(
  provider: string | null,
  mode: string | null,
  kind: string | null = null,
): ModePosture {
  if (!mode) return 'unknown';
  const known = knownPosture(provider, mode);
  if (known) return known;
  if (kind && KIND_POSTURES[kind]) return KIND_POSTURES[kind];
  if (READ_ONLY_ID.test(mode)) return 'read_only';
  return 'unknown';
}

export function isReadOnlyPosture(posture: ModePosture): boolean {
  return posture === 'read_only';
}

function permissionForPosture(posture: ModePosture): typeof PERMISSION_ASK | typeof PERMISSION_DO {
  return isReadOnlyPosture(posture) ? PERMISSION_ASK : PERMISSION_DO;
}

export function modeKind(modes: readonly AgentModeOption[], mode: string | null): string | null {
  return modes.find((option) => option.id === mode)?.kind ?? null;
}

export function permissionFor(
  provider: string,
  mode: string | null,
  modes: readonly AgentModeOption[] = [],
): typeof PERMISSION_ASK | typeof PERMISSION_DO {
  return permissionForPosture(modePosture(provider, mode, modeKind(modes, mode)));
}

export function defaultModeFor(provider: string | null): string | null {
  return providerModes(provider)?.defaultMode ?? null;
}

export function modeSkipsGate(
  provider: string | null,
  mode: string | null,
  kind: string | null = null,
): boolean {
  if (!mode) return false;
  const table = providerModes(provider);
  if (table?.skipsGate.includes(mode)) return true;
  if (table?.postures[mode]) return false;
  const posture = modePosture(provider, mode, kind);
  return posture === 'unknown' || posture === 'auto' || posture === 'full_access';
}

function firstModeWith(table: ProviderModeTable, postures: readonly ModePosture[]): string | null {
  for (const wanted of postures) {
    const match = Object.entries(table.postures).find(([, value]) => value === wanted);
    if (match) return match[0];
  }
  return null;
}

const TRANSLATIONS: Readonly<Record<ModePosture, ModePosture[]>> = {
  read_only: ['read_only'],
  asks: ['asks'],
  denies: ['denies', 'asks'],
  edits: ['edits', 'auto', 'asks'],
  auto: ['auto', 'edits', 'asks'],
  full_access: ['full_access', 'auto', 'edits', 'asks'],
  unknown: ['asks'],
};

export function translateMode(
  from: string | null,
  mode: string | null,
  to: string | null,
): string | null {
  if (!mode || from === to) return mode;
  const target = providerModes(to);
  if (!target) return null;
  return firstModeWith(target, TRANSLATIONS[modePosture(from, mode)]) ?? target.askingMode;
}

const LEGACY_POSTURES: Readonly<Record<InvolvementLevel, readonly ModePosture[]>> = {
  'hands-off': ['edits', 'auto', 'asks'],
  'full-auto': ['full_access', 'edits', 'auto', 'asks'],
};

const LEGACY_ASKING: readonly ModePosture[] = ['asks'];

export function modeForLegacy(
  provider: string,
  permission: string | null,
  level: InvolvementLevel | null,
): string | null {
  const table = providerModes(provider);
  if (!table) return null;
  if (permission !== PERMISSION_DO) return table.readOnlyMode;
  const wanted = (level ? LEGACY_POSTURES[level] : LEGACY_ASKING).filter(
    (posture) => posture !== 'full_access',
  );
  return firstModeWith(table, wanted) ?? table.askingMode;
}

const POSTURE_LINES: Readonly<Record<ModePosture, string>> = {
  read_only: 'Agent only reads',
  asks: 'Agent asks before edits and commands',
  edits: 'Edits go through, commands ask',
  auto: 'Agent decides what to ask',
  denies: "Agent won't ask and skips anything not pre-approved",
  full_access: "Agent won't ask",
  unknown: 'Agent decides when to ask',
};

const AUTONOMY_LINES: Readonly<Record<InvolvementLevel, string>> = {
  'hands-off': 'kept automatically',
  'full-auto': 'kept and opened as a PR',
};

export interface CombinationFacts {
  provider: string | null;
  mode: string | null;
  kind?: string | null;
  level: InvolvementLevel;
  hasRepos: boolean;
}

export function combinationLine(facts: CombinationFacts): string {
  const posture = modePosture(facts.provider, facts.mode, facts.kind);
  if (isReadOnlyPosture(posture)) return `${POSTURE_LINES.read_only} · nothing changes`;
  if (!facts.hasRepos) return `${POSTURE_LINES[posture]} · files stay with this chat`;
  const parts = [POSTURE_LINES[posture], AUTONOMY_LINES[facts.level]];
  if (facts.level === 'full-auto') parts.push('in a worktree copy');
  parts.push('Revert available');
  return parts.join(' · ');
}

export function combinationWarning(facts: CombinationFacts): string | null {
  const posture = modePosture(facts.provider, facts.mode, facts.kind);
  if (isReadOnlyPosture(posture)) return null;
  if (modeSkipsGate(facts.provider, facts.mode, facts.kind)) {
    return 'In this mode the agent acts without asking. Spark watches every action, marks it ran without review, and flags anything that crosses a safety rail.';
  }
  return null;
}
