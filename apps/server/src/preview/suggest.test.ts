import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { likelyPort, readPreviewSuggestions, suggestPreviews } from './suggest.ts';

const none = { launchJson: null, packageJson: null, runner: 'npm' as const };

describe('preview suggestions', () => {
  it('reads an existing .claude/launch.json without changing it', () => {
    const launchJson = JSON.stringify({
      version: '0.0.1',
      configurations: [
        { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 },
        {
          name: 'docs site',
          runtimeExecutable: 'node',
          runtimeArgs: ['serve docs.js', '--open'],
          port: 4000,
          url: 'http://localhost:4000/guide',
        },
        { name: 'staging', runtimeExecutable: 'true', url: 'https://staging.example.com' },
      ],
    });
    expect(suggestPreviews({ ...none, launchJson })).toEqual([
      {
        source: 'launch.json',
        label: 'web · .claude/launch.json',
        config: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          folder: null,
          readyUrl: null,
        },
      },
      {
        source: 'launch.json',
        label: 'docs site · .claude/launch.json',
        config: {
          command: "node 'serve docs.js' --open",
          url: 'http://localhost:4000/guide',
          folder: null,
          readyUrl: null,
        },
      },
    ]);
  });

  it('suggests the dev script with the package manager and the framework port', () => {
    const packageJson = JSON.stringify({
      scripts: { dev: 'vite', build: 'vite build', start: 'node server.js --port 8123' },
      devDependencies: { vite: '^7.0.0' },
    });
    expect(
      suggestPreviews({ ...none, packageJson, runner: 'pnpm' }).map((entry) => entry.config),
    ).toEqual([
      expect.objectContaining({ command: 'pnpm dev', url: 'http://localhost:5173' }),
      expect.objectContaining({ command: 'pnpm start', url: 'http://localhost:8123' }),
    ]);
    expect(suggestPreviews({ ...none, packageJson }).map((entry) => entry.config.command)).toEqual([
      'npm run dev',
      'npm start',
    ]);
  });

  it('knows the usual ports and falls back to 3000', () => {
    expect(likelyPort('next dev', [])).toBe(3000);
    expect(likelyPort('astro dev', [])).toBe(4321);
    expect(likelyPort('ng serve', [])).toBe(4200);
    expect(likelyPort('node dev.js', ['vite'])).toBe(5173);
    expect(likelyPort('PORT=4010 node server.js', ['vite'])).toBe(4010);
    expect(likelyPort('node server.js', [])).toBe(3000);
  });

  it('ignores files that are not what they claim to be', () => {
    expect(suggestPreviews({ ...none, launchJson: '{ not json', packageJson: '[]' })).toEqual([]);
    expect(
      suggestPreviews({ ...none, launchJson: JSON.stringify({ configurations: 'all' }) }),
    ).toEqual([]);
  });

  it('reads both files from a project folder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'spark-preview-suggest-'));
    try {
      await mkdir(path.join(root, '.claude'));
      await writeFile(
        path.join(root, '.claude', 'launch.json'),
        JSON.stringify({
          configurations: [
            { name: 'site', runtimeExecutable: 'node', runtimeArgs: ['s.js'], port: 4100 },
          ],
        }),
      );
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { dev: 'next dev' } }),
      );
      await writeFile(path.join(root, 'yarn.lock'), '');
      const found = await readPreviewSuggestions(root);
      expect(found.map((entry) => [entry.source, entry.config.command, entry.config.url])).toEqual([
        ['launch.json', 'node s.js', 'http://localhost:4100'],
        ['package.json', 'yarn dev', 'http://localhost:3000'],
      ]);
      expect(await readPreviewSuggestions(path.join(root, 'missing'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
