import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ProviderId } from '@spark-outpost/contracts';
import { SECRET_FILE_PATTERNS } from '../../projects/secret-files.ts';

export interface AgentLaunch {
  command: string;
  args: string[];
}

export interface AgentDefinition {
  id: ProviderId;
  name: string;
  launch: () => AgentLaunch;
  conversationMode: string;
  readsProjectFolders: boolean;
  conversationSessionMeta?: Record<string, unknown>;
  conversationEnv?: (workdir: string, browsing?: boolean) => Record<string, string>;
  projectSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  planSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  doSessionMeta?: (extraRoots: readonly string[]) => Record<string, unknown>;
  doUnavailableReason?: string;
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
export const CODEX_DO_UNAVAILABLE =
  "Codex can't ask before each command yet: codex-acp 1.13.1 runs commands inside its sandbox without a permission request, so Spark Outpost can't approve them. Use Claude for Do.";

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

export const agentDefinitions: Record<ProviderId, AgentDefinition> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    launch: () => packageBin('@agentclientprotocol/claude-agent-acp'),
    conversationMode: 'default',
    readsProjectFolders: true,
    conversationSessionMeta: claudeSessionMeta([], []),
    projectSessionMeta: (extraRoots) => claudeSessionMeta(['Read', 'Glob', 'Grep'], extraRoots),
    planSessionMeta: (extraRoots) => claudeSessionMeta(CLAUDE_PLAN_TOOLS, extraRoots),
    doSessionMeta: (extraRoots) =>
      claudeSessionMeta(CLAUDE_DO_TOOLS, extraRoots, CLAUDE_DO_ASK_RULES),
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    launch: () => packageBin('@agentclientprotocol/codex-acp'),
    conversationMode: 'read-only',
    readsProjectFolders: true,
    conversationEnv: codexEnv,
    doUnavailableReason: CODEX_DO_UNAVAILABLE,
  },
};
