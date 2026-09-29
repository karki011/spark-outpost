import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoRootLaunch } from './launch.ts';
import { pluginFiles, writePluginDir } from './plugin-dir.ts';

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repoWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-dir-repo-'));
  cleanups.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

function launchFor(root: string, parts: Partial<RepoRootLaunch>): RepoRootLaunch {
  return {
    root,
    label: 'repo',
    instructions: null,
    nested: [],
    skills: null,
    commands: [],
    subagents: [],
    hooks: null,
    mcpServers: [],
    allowRules: [],
    redirects: null,
    ...parts,
  };
}

const definition = (name: string, path: string) => ({ name, description: '', path });

describe('pluginFiles', () => {
  it('skips definitions whose names would leave the plugin folder', async () => {
    const root = await repoWith({
      '.claude/commands/evil.md': '---\nname: ../../x\n---\nbody',
      '.claude/commands/ok.md': 'body',
      '.claude/skills/bad/SKILL.md': 'body',
      '.claude/agents/helper.md': 'body',
    });
    const files = await pluginFiles(
      launchFor(root, {
        commands: [
          definition('../../x', '.claude/commands/evil.md'),
          definition('..:..:x', '.claude/commands/evil.md'),
          definition('team:ok', '.claude/commands/ok.md'),
        ],
        skills: [
          definition('..', '.claude/skills/bad/SKILL.md'),
          definition('a b', '.claude/skills/bad/SKILL.md'),
        ],
        subagents: [definition('helper', '.claude/agents/helper.md')],
      }),
      'repo',
    );
    expect(files.map((file) => file.path)).toEqual([
      '.claude-plugin/plugin.json',
      'commands/team/ok.md',
      'agents/helper.md',
    ]);
  });
});

describe('writePluginDir', () => {
  it('refuses a file path outside the plugin folder', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'plugin-dir-outer-'));
    cleanups.push(outer);
    const base = join(outer, 'base');
    await expect(
      writePluginDir(
        [
          { path: 'commands/ok.md', text: 'x' },
          { path: 'commands/../../../escaped.md', text: 'x' },
        ],
        base,
      ),
    ).rejects.toThrow();
    expect(await readdir(outer)).toEqual([]);
  });
});
