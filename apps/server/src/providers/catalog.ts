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
  keyLink: KeyLink | null;
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

const CLAUDE_PACKAGE = '@anthropic-ai/claude-code';
const CLAUDE_INSTALL_COMMAND = `npm i -g ${CLAUDE_PACKAGE}`;
const CLAUDE_INSTALL_HINT = `Install it with \`${CLAUDE_INSTALL_COMMAND}\` (or Anthropic's native installer), then try again.`;

const THINKING_EFFORTS: Choice[] = [
  effort('low', 'Low', 'Light thinking, fastest replies'),
  effort('high', 'High', 'Thinks longer on hard problems'),
  effort('max', 'Max', 'Deepest thinking, slowest replies'),
];

export const catalog: readonly CatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude',
    maker: 'Anthropic',
    cli: 'claude',
    keyPrefix: 'sk-ant-',
    keyHint:
      "Find it in the Claude Console under API keys. It's stored in your system keychain. API key mode also needs the claude CLI installed.",
    keyLink: { text: 'Claude Console', url: 'https://platform.claude.com/settings/keys' },
    note: null,
    installHint: CLAUDE_INSTALL_HINT,
    loginHint: 'Run `claude auth login` in a terminal, then try again.',
    packageName: CLAUDE_PACKAGE,
    installCommand: CLAUDE_INSTALL_COMMAND,
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
    keyHint:
      "Find it in the OpenAI dashboard under API keys. It's stored in your system keychain. API key mode also needs the codex CLI installed.",
    keyLink: { text: 'OpenAI dashboard', url: 'https://platform.openai.com/api-keys' },
    note: null,
    installHint:
      'Install it with `npm i -g @openai/codex` (or `brew install --cask codex`), then try again.',
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
    cli: 'claude',
    keyPrefix: '',
    keyHint: "Create one in the Z.ai console under API keys. It's stored in your system keychain.",
    keyLink: { text: 'Z.ai console', url: 'https://z.ai/manage-apikey/apikey-list' },
    note: 'Runs through the claude CLI with your Z.ai API key and Z.ai billing; never your Claude account.',
    installHint: CLAUDE_INSTALL_HINT,
    loginHint: '',
    packageName: CLAUDE_PACKAGE,
    installCommand: CLAUDE_INSTALL_COMMAND,
    loginCommand: '',
    methods: ['api_key'],
    doAvailable: true,
    efforts: THINKING_EFFORTS,
    defaultEffort: 'high',
  },
  {
    id: 'custom',
    name: 'Custom endpoint',
    maker: 'your server',
    cli: 'claude',
    keyPrefix: '',
    keyHint:
      "Only if your server asks for one. It's stored in your system keychain. Local servers such as Ollama need none.",
    keyLink: null,
    note: 'Runs the claude CLI against your own server, which must speak the Anthropic Messages API. How well tools work depends on the model.',
    installHint: CLAUDE_INSTALL_HINT,
    loginHint: '',
    packageName: CLAUDE_PACKAGE,
    installCommand: CLAUDE_INSTALL_COMMAND,
    loginCommand: '',
    methods: ['api_key'],
    doAvailable: true,
    efforts: THINKING_EFFORTS,
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
    role: "Labels Map areas, sorts pull request feedback and picks what a chat's island update says. It is never asked during a turn and never runs chats or grants permissions.",
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
