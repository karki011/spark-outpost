import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { InvolvementLevel, ProviderId } from '@spark-outpost/contracts';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';
import { ZAI_EFFORTS, ZAI_MODELS, zaiLaunchEnvironment, zaiModelId } from './zai.ts';

export interface AgentLaunch {
  command: string;
  args: string[];
}

export interface AgentOffers {
  models: readonly string[];
  efforts: readonly string[];
}

export interface AgentDefinition {
  id: ProviderId;
  name: string;
  launch: () => AgentLaunch;
  keyEnvironment?: (apiKey: string) => Promise<Record<string, string>>;
  offers?: AgentOffers;
  usedModel?: (model: string | null) => string | null;
  estimatesCost?: boolean;
  inputExcludesCache?: boolean;
  conversationMode: string;
  readsProjectFolders: boolean;
  conversationSessionMeta?: Record<string, unknown>;
  conversationEnv?: (workdir: string, browsing?: boolean) => Record<string, string>;
  projectSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  planSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  doSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  doMode?: string;
  doPrimaryRootOnly?: boolean;
  doWorktreeLevels?: readonly InvolvementLevel[];
}

export const CLAUDE_DO_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'] as const;
export const CLAUDE_PLAN_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
] as const;
export const CLAUDE_DO_ASK_RULES = ['Bash', 'Edit', 'Write'] as const;
export const CODEX_DO_MODE = 'ask-every-action';

export function secretReadRules(extraRoots: readonly string[]): string[] {
  const underCwd = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);
  const underExtraRoots = extraRoots.flatMap((root) =>
    SECRET_FILE_PATTERNS.map((pattern) => `/${root}/**/${pattern}`),
  );
  return [...underCwd, ...underExtraRoots].map((pattern) => `Read(${pattern})`);
}

export function claudeSessionMeta(
  tools: readonly string[],
  extraRoots: readonly string[],
  ask: readonly string[] = [],
): Record<string, unknown> {
  const deny = secretReadRules(extraRoots);
  return {
    claudeCode: {
      options: {
        tools: [...tools],
        disallowedTools: deny,
        settingSources: [],
        allowDangerouslySkipPermissions: false,
        settings: {
          permissions: {
            deny,
            ...(ask.length > 0 ? { ask: [...ask] } : {}),
            blockReadsOutsideWorkingDirectories: true,
            disableBypassPermissionsMode: 'disable',
          },
        },
        strictMcpConfig: true,
      },
    },
  };
}

function codexEnv(workdir: string, browsing = false): Record<string, string> {
  return {
    INITIAL_AGENT_MODE: 'read-only',
    TMPDIR: workdir,
    CODEX_CONFIG: JSON.stringify({
      features: { shell_tool: browsing, unified_exec: false },
      web_search: 'disabled',
    }),
  };
}

const require = createRequire(import.meta.url);

function packageBin(packageName: string): AgentLaunch {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin)[0];
  if (!bin) throw new Error(`${packageName} has no executable.`);
  return { command: process.execPath, args: [join(dirname(manifestPath), bin)] };
}

const claudeSessions = {
  conversationMode: 'default',
  readsProjectFolders: true,
  conversationSessionMeta: claudeSessionMeta([], []),
  projectSessionMeta: (extraRoots: readonly string[]) =>
    claudeSessionMeta(['Read', 'Glob', 'Grep'], extraRoots),
  planSessionMeta: (extraRoots: readonly string[]) =>
    claudeSessionMeta(CLAUDE_PLAN_TOOLS, extraRoots),
  doSessionMeta: (extraRoots: readonly string[]) =>
    claudeSessionMeta(CLAUDE_DO_TOOLS, extraRoots, CLAUDE_DO_ASK_RULES),
} satisfies Partial<AgentDefinition>;

const CLAUDE_ACP = '@agentclientprotocol/claude-agent-acp';
export const HIDE_CLAUDE_AUTH = '--hide-claude-auth';

function zaiLaunch(): AgentLaunch {
  const launch = packageBin(CLAUDE_ACP);
  return { ...launch, args: [...launch.args, HIDE_CLAUDE_AUTH] };
}

export function supportsDo(definition: AgentDefinition): boolean {
  return definition.doSessionMeta !== undefined || definition.doMode !== undefined;
}

export function buildsInWorktree(provider: string, level: InvolvementLevel): boolean {
  const definition = agentDefinitions[provider as ProviderId] as AgentDefinition | undefined;
  return definition?.doWorktreeLevels?.includes(level) ?? false;
}

export const agentDefinitions: Record<ProviderId, AgentDefinition> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    launch: () => packageBin(CLAUDE_ACP),
    ...claudeSessions,
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    launch: () => packageBin('@agentclientprotocol/codex-acp'),
    conversationMode: 'read-only',
    readsProjectFolders: true,
    conversationEnv: codexEnv,
    doMode: CODEX_DO_MODE,
    doPrimaryRootOnly: true,
    doWorktreeLevels: ['hands-off', 'full-auto'],
    inputExcludesCache: true,
  },
  zai: {
    id: 'zai',
    name: 'Z.ai (GLM)',
    launch: zaiLaunch,
    ...claudeSessions,
    keyEnvironment: (apiKey) => zaiLaunchEnvironment(apiKey),
    offers: { models: ZAI_MODELS.map((model) => model.slot), efforts: ZAI_EFFORTS },
    usedModel: zaiModelId,
    estimatesCost: true,
  },
};
