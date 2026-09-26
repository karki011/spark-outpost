import {
  PERMISSION_ASK,
  PERMISSION_DO,
  type AdvisorId,
  type Choice,
  type ConnectionMethod,
  type ProviderId,
} from '@spark-outpost/contracts';
import { CODEX_DO_UNAVAILABLE } from '../agents/acp/agents.ts';

export interface CatalogEntry {
  id: ProviderId;
  name: string;
  maker: string;
  cli: string;
  keyPrefix: string;
  keyHint: string;
  installHint: string;
  loginHint: string;
  packageName: string;
  installCommand: string;
  loginCommand: string;
  methods: ConnectionMethod[];
  permissions: Choice[];
  efforts: Choice[];
  defaultEffort: string;
}

const effort = (id: string, label: string, description: string): Choice => ({
  id,
  label,
  description,
  risky: false,
  unavailableReason: null,
});

const ASK_CHOICE: Choice = {
  id: PERMISSION_ASK,
  label: 'Ask',
  description: 'Reads files in linked repos, never changes them',
  risky: false,
  unavailableReason: null,
};

const doChoice = (unavailableReason: string | null = null): Choice => ({
  id: PERMISSION_DO,
  label: 'Do',
  description: 'Edits files and runs commands, asking as your involvement level says',
  risky: false,
  unavailableReason,
});

export function isSelectablePermission(entry: CatalogEntry, id: string): boolean {
  return entry.permissions.some((choice) => choice.id === id && choice.unavailableReason === null);
}

export const catalog: readonly CatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude',
    maker: 'Anthropic',
    cli: 'claude',
    keyPrefix: 'sk-ant-',
    keyHint: "Find it in the Claude Console under API keys. It's stored in your system keychain.",
    installHint:
      'Install it with `npm i -g @anthropic-ai/claude-code`, run `claude` once to log in, then try again.',
    loginHint: 'Run `claude auth login` in a terminal, then try again.',
    packageName: '@anthropic-ai/claude-code',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    methods: ['cli', 'api_key'],
    permissions: [ASK_CHOICE, doChoice()],
    efforts: [
      effort('low', 'Low', 'Quick replies, light reasoning'),
      effort('medium', 'Medium', 'Balanced for most tasks'),
      effort('high', 'High', 'Thinks longer on hard problems'),
      effort('max', 'Max', 'Deepest reasoning, slowest replies'),
    ],
    defaultEffort: 'high',
  },
  {
    id: 'codex',
    name: 'Codex',
    maker: 'OpenAI',
    cli: 'codex',
    keyPrefix: 'sk-',
    keyHint: "Find it in the OpenAI dashboard under API keys. It's stored in your system keychain.",
    installHint: 'Install it with `npm i -g @openai/codex`, run `codex login`, then try again.',
    loginHint: 'Run `codex login` in a terminal, then try again.',
    packageName: '@openai/codex',
    installCommand: 'npm i -g @openai/codex',
    loginCommand: 'codex login',
    methods: ['cli', 'api_key'],
    permissions: [ASK_CHOICE, doChoice(CODEX_DO_UNAVAILABLE)],
    efforts: [
      effort('low', 'Low', 'Quick replies, light reasoning'),
      effort('medium', 'Medium', 'Balanced for most tasks'),
      effort('high', 'High', 'Thinks longer on hard problems'),
    ],
    defaultEffort: 'medium',
  },
];

export interface AdvisorEntry {
  id: AdvisorId;
  name: string;
  maker: string;
  keyPrefix: string;
  keyHint: string;
  role: string;
  defaultModel: string;
}

export const advisorCatalog: readonly AdvisorEntry[] = [
  {
    id: 'jev',
    name: 'Jev',
    maker: 'TypeSafe',
    keyPrefix: '',
    keyHint:
      "Create one in the TypeSafe console under API keys. It's stored in your system keychain.",
    role: 'Suggests a provider, model, effort, and whether to review. It never runs chats or grants permissions.',
    defaultModel: 'jev-latest',
  },
];

export function advisorEntry(id: AdvisorId): AdvisorEntry {
  const entry = advisorCatalog.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown advisor ${id}.`);
  return entry;
}

export function catalogEntry(id: ProviderId): CatalogEntry {
  const entry = catalog.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown provider ${id}.`);
  return entry;
}
