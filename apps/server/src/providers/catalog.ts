import {
  type AdvisorId,
  type Choice,
  type ConnectionMethod,
  type KeyLink,
  type ProviderId,
} from '@spark-outpost/contracts';

export interface CatalogEntry {
  id: ProviderId;
  name: string;
  maker: string;
  cli: string;
  keyPrefix: string;
  keyHint: string;
  keyLink: KeyLink;
  note: string | null;
  installHint: string;
  loginHint: string;
  packageName: string;
  installCommand: string;
  loginCommand: string;
  methods: ConnectionMethod[];
  efforts: Choice[];
  defaultEffort: string;
  doAvailable: boolean;
}

const effort = (id: string, label: string, description: string): Choice => ({
  id,
  label,
  description,
  risky: false,
  unavailableReason: null,
});

export const catalog: readonly CatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude',
    maker: 'Anthropic',
    cli: 'claude',
    keyPrefix: 'sk-ant-',
    keyHint: "Find it in the Claude Console under API keys. It's stored in your system keychain.",
    keyLink: { text: 'Claude Console', url: 'https://platform.claude.com/settings/keys' },
    note: null,
    installHint:
      'Install it with `npm i -g @anthropic-ai/claude-code`, run `claude` once to log in, then try again.',
    loginHint: 'Run `claude auth login` in a terminal, then try again.',
    packageName: '@anthropic-ai/claude-code',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
    methods: ['cli', 'api_key'],
    doAvailable: true,
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
    keyLink: { text: 'OpenAI dashboard', url: 'https://platform.openai.com/api-keys' },
    note: null,
    installHint: 'Install it with `npm i -g @openai/codex`, run `codex login`, then try again.',
    loginHint: 'Run `codex login` in a terminal, then try again.',
    packageName: '@openai/codex',
    installCommand: 'npm i -g @openai/codex',
    loginCommand: 'codex login',
    methods: ['cli', 'api_key'],
    doAvailable: true,
    efforts: [
      effort('low', 'Low', 'Quick replies, light reasoning'),
      effort('medium', 'Medium', 'Balanced for most tasks'),
      effort('high', 'High', 'Thinks longer on hard problems'),
    ],
    defaultEffort: 'medium',
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    maker: 'Z.ai',
    cli: '',
    keyPrefix: '',
    keyHint: "Create one in the Z.ai console under API keys. It's stored in your system keychain.",
    keyLink: { text: 'Z.ai console', url: 'https://z.ai/manage-apikey/apikey-list' },
    note: 'Uses your Z.ai API key and Z.ai billing; never your Claude account.',
    installHint: '',
    loginHint: '',
    packageName: '',
    installCommand: '',
    loginCommand: '',
    methods: ['api_key'],
    doAvailable: true,
    efforts: [
      effort('low', 'Low', 'Light thinking, fastest replies'),
      effort('high', 'High', 'Thinks longer on hard problems'),
      effort('max', 'Max', 'Deepest thinking, slowest replies'),
    ],
    defaultEffort: 'high',
  },
];

export interface AdvisorEntry {
  id: AdvisorId;
  name: string;
  maker: string;
  keyPrefix: string;
  keyHint: string;
  keyLink: KeyLink;
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
    keyLink: { text: 'TypeSafe console', url: 'https://console.typesafe.ai/keys' },
    role: 'Chooses the depth, models, and next steps, and watches running agents for loops. It never runs chats or grants permissions.',
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
