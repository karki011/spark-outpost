import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ProviderId } from '@spark-outpost/contracts';
import { BUILDER_GIT_OPS, PUBLISH_COMMANDS } from '../../approvals/git-commands.ts';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';
import type { UsageReadings } from '../../providers/provider.ts';
import type { ClaudeRepoOptions, CodexRepoOptions, RepoStyle } from './repo-session.ts';
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
  usageReadings?: UsageReadings;
  conversationMode: string;
  readsProjectFolders: boolean;
  repoStyle: RepoStyle;
  conversationSessionMeta?: (repo?: ClaudeRepoOptions | null) => Record<string, unknown>;
  conversationEnv?: (
    workdir: string,
    browsing?: boolean,
    repo?: CodexRepoOptions | null,
  ) => Record<string, string>;
  projectSessionMeta?: (
    extraRoots: readonly string[],
    repo?: ClaudeRepoOptions | null,
  ) => Record<string, unknown>;
  doSessionMeta?: (
    extraRoots: readonly string[],
    repo?: ClaudeRepoOptions | null,
    builder?: boolean,
    coordinated?: boolean,
  ) => Record<string, unknown>;
  probeSessionMeta?: Record<string, unknown>;
  askMode: string;
  doMode?: string;
  doPrimaryRootOnly?: boolean;
}

const CLAUDE_DO_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash',
  'TodoWrite',
  'EnterPlanMode',
  'ExitPlanMode',
] as const;
export const CLAUDE_DO_ASK_RULES = ['Bash', 'Edit', 'Write'] as const;
const CLAUDE_DO_MODE = 'default';
export const CODEX_DO_MODE = 'ask-every-action';

export const BUILDER_PUBLISH_DENY_RULES = PUBLISH_COMMANDS.map((command) => `Bash(${command}:*)`);

export const BUILDER_GIT_DENY_RULES = [
  ...BUILDER_GIT_OPS.map((op) => `Bash(git ${op}:*)`),
  'Bash(git branch -d:*)',
  'Bash(git branch -D:*)',
  'Bash(git branch --delete:*)',
];

function builderDeny(builder: boolean, coordinated: boolean): string[] {
  if (!builder) return [];
  return coordinated
    ? [...BUILDER_PUBLISH_DENY_RULES, ...BUILDER_GIT_DENY_RULES]
    : BUILDER_PUBLISH_DENY_RULES;
}

export function secretReadRules(extraRoots: readonly string[]): string[] {
  const underCwd = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);
  const underExtraRoots = extraRoots.flatMap((root) =>
    SECRET_FILE_PATTERNS.map((pattern) => `/${root}/**/${pattern}`),
  );
  return [...underCwd, ...underExtraRoots].map((pattern) => `Read(${pattern})`);
}

function repoTools(repo: ClaudeRepoOptions | null, coordinated: boolean): string[] {
  if (!repo) return [];
  const agentTool = repo.agentTool && !coordinated;
  return [...(repo.skillTool ? ['Skill'] : []), ...(agentTool ? ['Agent'] : [])];
}

export function claudeSessionMeta(
  tools: readonly string[],
  extraRoots: readonly string[],
  ask: readonly string[] = [],
  repo: ClaudeRepoOptions | null = null,
  builder = false,
  allowBypass = false,
  coordinated = false,
): Record<string, unknown> {
  const deny = [...secretReadRules(extraRoots), ...builderDeny(builder, coordinated)];
  const askRules = [...ask, ...(repo?.mcpNames ?? []).map((name) => `mcp__${name}`)];
  const allowRules = [...(repo?.allowRules ?? [])];
  const plugins = repo?.plugins ?? [];
  return {
    ...(repo?.appendPrompt ? { systemPrompt: { append: repo.appendPrompt } } : {}),
    claudeCode: {
      options: {
        tools: [...tools, ...repoTools(repo, coordinated)],
        disallowedTools: deny,
        settingSources: [],
        ...(plugins.length > 0
          ? { plugins: plugins.map((path) => ({ type: 'local', path })) }
          : {}),
        allowDangerouslySkipPermissions: allowBypass,
        settings: {
          ...(repo?.redirects?.commands ?? {}),
          ...(repo?.redirects && Object.keys(repo.redirects.env).length > 0
            ? { env: repo.redirects.env }
            : {}),
          ...(repo?.hooks ? { hooks: repo.hooks } : { disableAllHooks: true }),
          disableSkillShellExecution: true,
          permissions: {
            deny,
            ...(askRules.length > 0 ? { ask: askRules } : {}),
            ...(allowRules.length > 0 ? { allow: allowRules } : {}),
            blockReadsOutsideWorkingDirectories: true,
            ...(allowBypass ? {} : { disableBypassPermissionsMode: 'disable' }),
          },
        },
        strictMcpConfig: true,
      },
    },
  };
}

export function codexConfig(browsing: boolean, repo: CodexRepoOptions | null): object {
  return {
    features: { shell_tool: browsing, unified_exec: false, skill_mcp_dependency_install: false },
    web_search: 'disabled',
    ...(repo && !repo.agentsMd ? { project_doc_max_bytes: 0 } : {}),
    ...(repo?.developerInstructions ? { developer_instructions: repo.developerInstructions } : {}),
    ...(repo && !repo.skills ? { skills: { include_instructions: false } } : {}),
  };
}

function codexEnv(
  workdir: string,
  browsing = false,
  repo: CodexRepoOptions | null = null,
): Record<string, string> {
  return {
    INITIAL_AGENT_MODE: 'read-only',
    TMPDIR: workdir,
    CODEX_CONFIG: JSON.stringify(codexConfig(browsing, repo)),
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
  repoStyle: 'claude',
  conversationMode: 'default',
  askMode: 'default',
  doMode: CLAUDE_DO_MODE,
  usageReadings: 'start_and_end',
  readsProjectFolders: true,
  conversationSessionMeta: (repo?: ClaudeRepoOptions | null) =>
    claudeSessionMeta([], [], [], repo ?? null),
  probeSessionMeta: claudeSessionMeta([], [], [], null, false, true),
  projectSessionMeta: (extraRoots: readonly string[], repo?: ClaudeRepoOptions | null) =>
    claudeSessionMeta(['Read', 'Glob', 'Grep'], extraRoots, [], repo ?? null),
  doSessionMeta: (
    extraRoots: readonly string[],
    repo?: ClaudeRepoOptions | null,
    builder = false,
    coordinated = false,
  ) =>
    claudeSessionMeta(
      CLAUDE_DO_TOOLS,
      extraRoots,
      CLAUDE_DO_ASK_RULES,
      repo ?? null,
      builder,
      true,
      coordinated,
    ),
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
    repoStyle: 'codex',
    conversationMode: 'read-only',
    askMode: 'read-only',
    readsProjectFolders: true,
    conversationEnv: codexEnv,
    doMode: CODEX_DO_MODE,
    doPrimaryRootOnly: true,
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
