import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type PluginTree = Record<string, string>;

export interface Installed {
  key: string;
  installPath: string;
}

export const EGM_LIKE: PluginTree = {
  '.claude-plugin/plugin.json': JSON.stringify({
    name: 'egm',
    description: 'Draft specs and review designs.',
    agents: ['./.claude-plugin/agents/critic.md', './.claude-plugin/agents/style.md'],
  }),
  'plugin.json': JSON.stringify({ name: 'egm', extensions: { 'com.openai': {} } }),
  '.claude-plugin/agents/critic.md': '---\nname: critic\ndescription: Critic\n---\nReview it.\n',
  '.claude-plugin/agents/style.md': '---\nname: style\nomitClaudeMd: true\n---\nCheck style.\n',
  'agents/critic.md': '---\nname: critic\ndescription: Critic\n---\nReview it.\n',
  'agents/style.md': '---\nname: style\nomitClaudeMd: true\n---\nCheck style.\n',
  'skills/egm-draft/SKILL.md': [
    '---',
    'name: egm-draft',
    'description: >-',
    '  Draft a spec. Skip this when the',
    '  user only asks a question.',
    'disable-model-invocation: true',
    '---',
    'Read `${CLAUDE_PLUGIN_ROOT}/docs/claude.md` first.',
    '',
  ].join('\n'),
  'skills/egm-review/SKILL.md': '---\nname: egm-review\n---\nReview with fresh reviewers.\n',
  'docs/claude.md': 'Uses your host models and permissions. Keep your API keys in .env files.\n',
  'docs/privacy.md': 'Nothing leaves your machine except model requests.\n',
  'assets/icon.svg': `<svg><path d="M${'A1b2C3d4'.repeat(80)}"/></svg>`,
};

export async function writeTree(root: string, tree: PluginTree): Promise<void> {
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    if (path.endsWith('.sh')) await chmod(join(root, path), 0o755);
  }
}

export function cachePath(configDir: string, key: string): string {
  const [name, marketplace] = key.split('@') as [string, string];
  return join(configDir, 'plugins', 'cache', marketplace, name, '1.0.0');
}

export async function writeInstalled(configDir: string, installs: Installed[]): Promise<void> {
  await mkdir(join(configDir, 'plugins', 'cache'), { recursive: true });
  const plugins = Object.fromEntries(
    installs.map(({ key, installPath }) => [
      key,
      [{ scope: 'user', installPath, version: '1.0.0', installedAt: '2026-10-01T00:00:00Z' }],
    ]),
  );
  await writeFile(
    join(configDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
  );
}

export async function installPlugin(
  configDir: string,
  key: string,
  tree: PluginTree,
): Promise<string> {
  const root = cachePath(configDir, key);
  await writeTree(root, tree);
  return root;
}
