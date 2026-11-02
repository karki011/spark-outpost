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

describe('pluginFiles inline shell', () => {
  const sources = {
    '.claude/commands/now.md': '---\ndescription: Time\n---\nTime: !`date`\n',
    '.claude/skills/ctx/SKILL.md': '---\nname: ctx\n---\nBranch: !`git branch`\n',
  };
  const parts = () => ({
    commands: [definition('now', '.claude/commands/now.md')],
    skills: [definition('ctx', '.claude/skills/ctx/SKILL.md')],
  });
  const bodies = (files: { path: string; text: string }[]) =>
    Object.fromEntries(files.map((file) => [file.path, file.text]));

  it('keeps repo skills and commands byte for byte unless the session runs inline shell', async () => {
    const root = await repoWith(sources);
    const files = await pluginFiles(launchFor(root, parts()), 'repo');
    expect(bodies(files)).toEqual({
      '.claude-plugin/plugin.json':
        '{"name":"repo","description":"Skills, commands and subagents from repo"}',
      'skills/ctx/SKILL.md': `---\nname: "ctx"\n---\nBranch: !\`git branch\`\n\nOther files for this skill are in ${join(root, '.claude/skills/ctx')}.\n`,
      'commands/now.md': '---\ndescription: "Time"\n---\nTime: !`date`\n',
    });
    expect(JSON.stringify(files)).not.toContain('\u200b');
  });

  it('breaks inline shell in repo definitions when a user plugin turns it on', async () => {
    const root = await repoWith(sources);
    const off = await pluginFiles(launchFor(root, parts()), 'repo');
    const on = await pluginFiles(launchFor(root, parts()), 'repo', true);
    expect(bodies(on)['commands/now.md']).toBe(
      '---\ndescription: "Time"\n---\nTime: !\u200b`date`\n',
    );
    expect(bodies(on)['skills/ctx/SKILL.md']).toContain('Branch: !\u200b`git branch`');
    const base = await mkdtemp(join(tmpdir(), 'plugin-dir-shell-'));
    cleanups.push(base);
    expect(await writePluginDir(on, base)).not.toBe(await writePluginDir(off, base));
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
