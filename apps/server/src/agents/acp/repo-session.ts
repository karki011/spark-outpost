import type * as acp from '@agentclientprotocol/sdk';
import { followedFiles, instructionsPrompt, isAgentsMd } from '../../agent-config/instructions.ts';
import type { RepoLaunch } from '../../agent-config/launch.ts';
import { expandReferences, type McpServerConfig } from '../../agent-config/mcp-json.ts';
import { pluginFiles, pluginName, writePluginDir } from '../../agent-config/plugin-dir.ts';
import type { RedirectSettings } from '../../agent-config/redirects.ts';
import type { HooksConfig } from '../../agent-config/settings-files.ts';
import { childEnvironment } from '../../setup/environment.ts';

export type RepoStyle = 'claude' | 'codex';

export interface ClaudeRepoOptions {
  appendPrompt: string | null;
  plugins: string[];
  hooks: HooksConfig | null;
  mcpNames: string[];
  skillTool: boolean;
  agentTool: boolean;
  allowRules?: readonly string[];
  redirects?: RedirectSettings | null;
}

export interface CodexRepoOptions {
  developerInstructions: string | null;
  agentsMd: boolean;
  skills: boolean;
}

export interface NamedMcpServer {
  name: string;
  config: McpServerConfig;
}

export interface RepoSession {
  following: string[];
  mcpServers: NamedMcpServer[];
  claude: ClaudeRepoOptions | null;
  codex: CodexRepoOptions | null;
}

function mergedHooks(launch: RepoLaunch): HooksConfig | null {
  const merged: HooksConfig = {};
  for (const root of launch) {
    for (const [event, entries] of Object.entries(root.hooks ?? {})) {
      merged[event] = [...(merged[event] ?? []), ...entries];
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

export function namedMcpServers(
  launch: RepoLaunch,
  user: readonly McpServerConfig[] = [],
  reserved: readonly string[] = [],
): NamedMcpServer[] {
  const taken = new Set(reserved);
  const named: NamedMcpServer[] = [];
  const add = (config: McpServerConfig, suffix: string) => {
    const base = safeName(config.name);
    const name = taken.has(base) ? `${base}_${safeName(suffix)}` : base;
    if (taken.has(name)) return;
    taken.add(name);
    named.push({ name, config });
  };
  for (const config of user) add(config, 'spark');
  for (const root of launch) {
    for (const config of root.mcpServers) add(config, root.label);
  }
  return named;
}

function mergedAllowRules(launch: RepoLaunch): string[] {
  return [...new Set(launch.flatMap((root) => root.allowRules))];
}

function mergedRedirects(launch: RepoLaunch): RedirectSettings | null {
  const confirmed = launch.flatMap((root) => (root.redirects ? [root.redirects] : []));
  if (confirmed.length === 0) return null;
  const merged: RedirectSettings = { env: {}, commands: {} };
  for (const redirects of confirmed.reverse()) {
    Object.assign(merged.env, redirects.env);
    Object.assign(merged.commands, redirects.commands);
  }
  return merged;
}

async function claudePlugins(launch: RepoLaunch): Promise<string[]> {
  const taken = new Set<string>();
  const dirs: string[] = [];
  for (const root of launch) {
    const name = pluginName(root.label, taken);
    const files = await pluginFiles(root, name);
    if (files.length === 0) continue;
    taken.add(name);
    dirs.push(await writePluginDir(files));
  }
  return dirs;
}

async function claudeOptions(
  launch: RepoLaunch,
  mcp: NamedMcpServer[],
): Promise<ClaudeRepoOptions> {
  return {
    appendPrompt: instructionsPrompt(launch),
    plugins: await claudePlugins(launch),
    hooks: mergedHooks(launch),
    mcpNames: mcp.map((server) => server.name),
    skillTool: launch.some((root) => (root.skills?.length ?? 0) > 0),
    agentTool: launch.some((root) => root.subagents.length > 0),
    allowRules: mergedAllowRules(launch),
    redirects: mergedRedirects(launch),
  };
}

function codexOptions(launch: RepoLaunch): CodexRepoOptions {
  const primary = launch[0];
  return {
    developerInstructions: instructionsPrompt(
      launch,
      (rootIndex, path) => rootIndex === 0 && isAgentsMd(path),
    ),
    agentsMd: primary ? primary.instructions !== null : true,
    skills: primary ? primary.skills !== null : true,
  };
}

export async function prepareRepoSession(
  launch: RepoLaunch,
  style: RepoStyle,
  user: readonly McpServerConfig[] = [],
  reserved: readonly string[] = [],
): Promise<RepoSession> {
  const mcpServers = namedMcpServers(launch, user, reserved);
  return {
    following: followedFiles(launch),
    mcpServers,
    claude: style === 'claude' ? await claudeOptions(launch, mcpServers) : null,
    codex: style === 'codex' ? codexOptions(launch) : null,
  };
}

function pairs(values: Record<string, string>, env: Readonly<Record<string, string>>) {
  return Object.entries(values).map(([name, value]) => ({
    name,
    value: expandReferences(value, env),
  }));
}

export function acpMcpServer(
  server: NamedMcpServer,
  env: Readonly<Record<string, string>> = childEnvironment(process.env),
): acp.McpServer {
  const { config, name } = server;
  if (config.transport === 'stdio') {
    return {
      name,
      command: expandReferences(config.command ?? '', env),
      args: config.args.map((arg) => expandReferences(arg, env)),
      env: pairs(config.env, env),
    };
  }
  return {
    type: config.transport,
    name,
    url: expandReferences(config.url ?? '', env),
    headers: pairs(config.headers, env),
  };
}

export function supportsTransport(
  init: acp.InitializeResponse,
  transport: McpServerConfig['transport'],
): boolean {
  if (transport === 'stdio') return true;
  return init.agentCapabilities?.mcpCapabilities?.[transport] === true;
}
