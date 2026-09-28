import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { InvolvementLevel, ProviderId } from '@spark-outpost/contracts';
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
  conversationSessionMeta?: Record<string, unknown>;
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
  ) => Record<string, unknown>;
  doMode?: string;
  doPrimaryRootOnly?: boolean;
  doWorktreeLevels?: readonly InvolvementLevel[];
}

export const CLAUDE_DO_TOOLS = [
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
export const CODEX_DO_MODE = 'ask-every-action';

/**
 * Builders never publish: pushing, pull requests and remote changes are the harness's job at
 * the end of the task (Ship). These deny rules back up the approval gate's refusal, which also
 * covers Codex (every Codex Do action goes through the gate).
 */
export const BUILDER_PUBLISH_DENY_RULES = [
  'Bash(git push:*)',
  'Bash(git remote add:*)',
  'Bash(git remote set-url:*)',
  'Bash(git remote remove:*)',
  'Bash(git remote rm:*)',
  'Bash(git remote rename:*)',
  'Bash(git send-email:*)',
  'Bash(git request-pull:*)',
  'Bash(gh:*)',
  'Bash(hub:*)',
  'Bash(glab:*)',
] as const;

export function secretReadRules(extraRoots: readonly string[]): string[] {
  const underCwd = SECRET_FILE_PATTERNS.map((pattern) => `**/${pattern}`);
  const underExtraRoots = extraRoots.flatMap((root) =>
    SECRET_FILE_PATTERNS.map((pattern) => `/${root}/**/${pattern}`),
  );
  return [...underCwd, ...underExtraRoots].map((pattern) => `Read(${pattern})`);
}

function repoTools(repo: ClaudeRepoOptions | null): string[] {
  if (!repo) return [];
  return [...(repo.skillTool ? ['Skill'] : []), ...(repo.agentTool ? ['Agent'] : [])];
}

export function claudeSessionMeta(
  tools: readonly string[],
  extraRoots: readonly string[],
  ask: readonly string[] = [],
  repo: ClaudeRepoOptions | null = null,
  builder = false,
): Record<string, unknown> {
  const deny = [...secretReadRules(extraRoots), ...(builder ? BUILDER_PUBLISH_DENY_RULES : [])];
  const askRules = [...ask, ...(repo?.mcpNames ?? []).map((name) => `mcp__${name}`)];
  const plugins = repo?.plugins ?? [];
  return {
    ...(repo?.appendPrompt ? { systemPrompt: { append: repo.appendPrompt } } : {}),
    claudeCode: {
      options: {
        tools: [...tools, ...repoTools(repo)],
        disallowedTools: deny,
        settingSources: [],
        ...(plugins.length > 0
          ? { plugins: plugins.map((path) => ({ type: 'local', path })) }
          : {}),
        allowDangerouslySkipPermissions: false,
        settings: {
          ...(repo?.hooks ? { hooks: repo.hooks } : { disableAllHooks: true }),
          disableSkillShellExecution: true,
          permissions: {
            deny,
            ...(askRules.length > 0 ? { ask: askRules } : {}),
            blockReadsOutsideWorkingDirectories: true,
            disableBypassPermissionsMode: 'disable',
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
  usageReadings: 'start_and_end',
  readsProjectFolders: true,
  conversationSessionMeta: claudeSessionMeta([], []),
  projectSessionMeta: (extraRoots: readonly string[], repo?: ClaudeRepoOptions | null) =>
    claudeSessionMeta(['Read', 'Glob', 'Grep'], extraRoots, [], repo ?? null),
  doSessionMeta: (
    extraRoots: readonly string[],
    repo?: ClaudeRepoOptions | null,
    builder = false,
  ) => claudeSessionMeta(CLAUDE_DO_TOOLS, extraRoots, CLAUDE_DO_ASK_RULES, repo ?? null, builder),
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
    repoStyle: 'codex',
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
