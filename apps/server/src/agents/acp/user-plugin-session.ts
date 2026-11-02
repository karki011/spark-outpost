import type { McpServerConfig } from '../../agent-config/mcp-json.ts';
import { isRecord } from '../../agent-config/records.ts';
import type { HookEntry, HooksConfig } from '../../agent-config/settings-files.ts';
import { writeUserPluginDir } from '../../agent-config/user-plugins/copy.ts';
import type { UserPluginLaunch } from '../../agent-config/user-plugins/launch.ts';
import {
  NO_CLAUDE_REPO,
  type ClaudeRepoOptions,
  type LabelledMcpServer,
  type NamedMcpServer,
} from './repo-session.ts';

export interface UserPluginSession {
  dirs: string[];
  hooks: HooksConfig;
  mcpServers: LabelledMcpServer[];
  skillTool: boolean;
  agentTool: boolean;
  skillShell: boolean;
}

const ROOT_REFERENCE = '${CLAUDE_PLUGIN_ROOT}';

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function withRoot(entry: HookEntry, dir: string): HookEntry {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
  return {
    ...entry,
    hooks: hooks.map((hook) =>
      isRecord(hook) && typeof hook.command === 'string'
        ? { ...hook, command: `export CLAUDE_PLUGIN_ROOT=${shellQuoted(dir)}; ${hook.command}` }
        : hook,
    ),
  };
}

function addHooks(merged: HooksConfig, hooks: HooksConfig, dir: string): void {
  for (const [event, entries] of Object.entries(hooks)) {
    merged[event] = [...(merged[event] ?? []), ...entries.map((entry) => withRoot(entry, dir))];
  }
}

function rootedValues(values: Record<string, string>, dir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, value.replaceAll(ROOT_REFERENCE, dir)]),
  );
}

function rootedServer(config: McpServerConfig, dir: string): McpServerConfig {
  const rooted = (value: string | null) => value?.replaceAll(ROOT_REFERENCE, dir) ?? null;
  return {
    ...config,
    command: rooted(config.command),
    args: config.args.map((arg) => arg.replaceAll(ROOT_REFERENCE, dir)),
    url: rooted(config.url),
    env: { ...rootedValues(config.env, dir), CLAUDE_PLUGIN_ROOT: dir },
    headers: rootedValues(config.headers, dir),
  };
}

export async function prepareUserPlugins(
  plugins: readonly UserPluginLaunch[],
): Promise<UserPluginSession | null> {
  if (plugins.length === 0) return null;
  const session: UserPluginSession = {
    dirs: [],
    hooks: {},
    mcpServers: [],
    skillTool: false,
    agentTool: false,
    skillShell: false,
  };
  for (const plugin of plugins) {
    const dir = await writeUserPluginDir(plugin);
    const { parsed } = plugin;
    session.dirs.push(dir);
    addHooks(session.hooks, parsed.hooksConfig, dir);
    session.mcpServers.push(
      ...parsed.mcpServers.map((config) => ({
        label: plugin.name,
        config: rootedServer(config, dir),
      })),
    );
    session.skillTool ||= parsed.skills.length + parsed.commands.length > 0;
    session.agentTool ||= parsed.agents.length > 0;
    session.skillShell ||= parsed.inlineShell.length > 0;
  }
  return session;
}

function mergedHooks(repo: HooksConfig | null, plugins: HooksConfig): HooksConfig | null {
  const merged: HooksConfig = { ...(repo ?? {}) };
  for (const [event, entries] of Object.entries(plugins)) {
    merged[event] = [...(merged[event] ?? []), ...entries];
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

export function withUserPlugins(
  repo: ClaudeRepoOptions | null,
  plugins: UserPluginSession | null,
  mcpServers: readonly NamedMcpServer[],
): ClaudeRepoOptions | null {
  if (!plugins) return repo;
  const base = repo ?? NO_CLAUDE_REPO;
  const pluginConfigs = new Set(plugins.mcpServers.map((server) => server.config));
  const askRules = mcpServers
    .filter((server) => pluginConfigs.has(server.config))
    .map((server) => `mcp__${server.name}`);
  return {
    ...base,
    plugins: [...base.plugins, ...plugins.dirs],
    hooks: mergedHooks(base.hooks, plugins.hooks),
    skillTool: base.skillTool || plugins.skillTool,
    agentTool: base.agentTool || plugins.agentTool,
    skillShell: plugins.skillShell,
    askRules: [...(base.askRules ?? []), ...askRules],
  };
}
