import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeConfiguredRepo, markerPath, writeFiles } from '../../test/repo-config-fixture.ts';
import { createRepoScanner, type RepoScan } from './discovery.ts';
import { parseFrontmatter } from './frontmatter.ts';

let base: string;
let root: string;
let scan: RepoScan;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-repo-config-')));
  root = join(base, 'app');
  await mkdir(root);
  await makeConfiguredRepo(root);
  scan = await createRepoScanner().scan(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('repo agent config discovery', () => {
  it('lists root and nested instruction files with sizes', () => {
    expect(scan.instructions.filter((file) => !file.nested).map((file) => file.path)).toEqual([
      'CLAUDE.md',
      'CLAUDE.local.md',
      'AGENTS.md',
      '.cursorrules',
      '.github/copilot-instructions.md',
      '.cursor/rules/style.mdc',
    ]);
    expect(scan.instructions.filter((file) => file.nested)).toEqual([
      { path: 'packages/api/AGENTS.md', bytes: 11, nested: true },
    ]);
  });

  it('reads skills from every skill folder with names and descriptions from frontmatter', () => {
    expect(scan.skills).toEqual([
      {
        name: 'lint',
        description: 'Runs the linter and fixes issues',
        path: '.agents/skills/lint/SKILL.md',
      },
      {
        name: 'zebra',
        description: 'Draws zebras when asked about stripes',
        path: '.claude/skills/zebra/SKILL.md',
      },
    ]);
  });

  it('names nested commands with colons and falls back to the first line', () => {
    expect(scan.commands).toEqual([
      { name: 'greet', description: 'Say hello', path: '.claude/commands/greet.md' },
      {
        name: 'ops:deploy',
        description: 'Deploy the app to staging.',
        path: '.claude/commands/ops/deploy.md',
      },
    ]);
    expect(scan.subagents).toEqual([
      { name: 'reviewer', description: 'Reviews diffs', path: '.claude/agents/reviewer.md' },
    ]);
  });

  it('previews hooks from both settings files with a stable fingerprint', async () => {
    expect(scan.hooks.map((hook) => [hook.event, hook.matcher, hook.source])).toEqual([
      ['SessionStart', null, '.claude/settings.json'],
      ['PreToolUse', 'Bash', '.claude/settings.json'],
      ['PreToolUse', 'Bash', '.claude/settings.json'],
      ['Stop', null, '.claude/settings.local.json'],
    ]);
    expect(scan.hooks[1]!.command).toContain('marker-hook-bash');
    expect(scan.hooks[2]!.command).toBe('HTTP https://hooks.example.com/x');
    expect(Object.keys(scan.hooksConfig)).toEqual(['SessionStart', 'PreToolUse', 'Stop']);
    expect(scan.hooksFingerprint).toMatch(/^[0-9a-f]{32}$/);
    const again = await createRepoScanner().scan(root);
    expect(again.hooksFingerprint).toBe(scan.hooksFingerprint);
  });

  it('lists MCP servers with transport, command or URL and env names, skipping broken ones', () => {
    expect(
      scan.mcpServers.map(({ name, transport, command, url }) => ({
        name,
        transport,
        command,
        url,
      })),
    ).toEqual([
      { name: 'echo', transport: 'stdio', command: 'node', url: null },
      { name: 'remote', transport: 'http', command: null, url: 'https://mcp.example.com/mcp' },
      { name: 'stream', transport: 'sse', command: null, url: 'https://mcp.example.com/sse' },
    ]);
    expect(Object.keys(scan.mcpServers[0]!.env)).toEqual(['ECHO_MODE', 'API_TOKEN']);
    expect(scan.warnings).toContain(
      'MCP server "broken" has no command or URL, so it was skipped.',
    );
  });

  it('reports repo permission rules, env and command settings as ignored', () => {
    expect(scan.ignored).toEqual([
      { source: '.claude/settings.json', kind: 'allow', items: ['Bash(*)', 'Edit'] },
      { source: '.claude/settings.json', kind: 'env', items: ['ANTHROPIC_BASE_URL', 'DEBUG'] },
      {
        source: '.claude/settings.json',
        kind: 'command',
        items: [expect.stringMatching(/^apiKeyHelper: touch /)],
      },
      {
        source: '.claude/settings.json',
        kind: 'setting',
        items: ['model', 'permissions.defaultMode'],
      },
      { source: '.codex/config.toml', kind: 'codex', items: ['Codex project config'] },
    ]);
  });

  it('never runs anything it finds', () => {
    for (const name of ['hook-start', 'hook-bash', 'hook-stop', 'api-key-helper', 'skill-shell']) {
      expect(existsSync(markerPath(root, name))).toBe(false);
    }
  });

  it('warns about unreadable settings instead of failing', async () => {
    const other = join(base, 'broken');
    await writeFiles(other, { '.claude/settings.json': '{nope', '.mcp.json': '[' });
    const broken = await createRepoScanner().scan(other);
    expect(broken.warnings).toEqual([
      '.claude/settings.json is not valid JSON, so it was skipped.',
      '.mcp.json is not valid JSON, so it was skipped.',
    ]);
    expect(broken.hooks).toEqual([]);
  });

  it('reuses the cached scan until a watched file changes', async () => {
    const scanner = createRepoScanner();
    const first = await scanner.scan(root);
    expect(await scanner.scan(root)).toBe(first);
    const agents = join(root, 'AGENTS.md');
    await writeFile(agents, 'Use pnpm, always.\n');
    await utimes(agents, new Date(), new Date(Date.now() + 5_000));
    const second = await scanner.scan(root);
    expect(second).not.toBe(first);
    expect(second.instructions.find((file) => file.path === 'AGENTS.md')?.bytes).toBe(18);
  });
});

describe('frontmatter', () => {
  it('reads quoted, folded, literal and list values and keeps the body', () => {
    const text = [
      '---',
      'name: "quoted: yes"',
      'description: >',
      '  one',
      '  two',
      'notes: |',
      '  first',
      '  second',
      'tools:',
      '  - Read',
      '  - Grep',
      '---',
      'Body line',
    ].join('\n');
    expect(parseFrontmatter(text)).toEqual({
      fields: {
        name: 'quoted: yes',
        description: 'one two',
        notes: 'first\nsecond',
        tools: 'Read, Grep',
      },
      body: 'Body line',
    });
    expect(parseFrontmatter('No frontmatter')).toEqual({ fields: {}, body: 'No frontmatter' });
  });
});
