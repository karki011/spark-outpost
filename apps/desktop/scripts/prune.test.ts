import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isDeadWeight, nodePtyLeftovers, pruneRuntime, pruneServer } from './prune.ts';

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function tree(files: string[]): Promise<string> {
  root = await mkdtemp(path.join(os.tmpdir(), 'spark-prune-'));
  for (const file of files) {
    await mkdir(path.join(root, path.dirname(file)), { recursive: true });
    await writeFile(path.join(root, file), '');
  }
  return root;
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

describe('isDeadWeight', () => {
  it('drops source maps, type declarations and readmes but keeps license notices and code', () => {
    expect(isDeadWeight('index.js.map')).toBe(true);
    expect(isDeadWeight('index.d.ts')).toBe(true);
    expect(isDeadWeight('index.d.mts')).toBe(true);
    expect(isDeadWeight('README.md')).toBe(true);
    expect(isDeadWeight('CHANGELOG.md')).toBe(true);
    expect(isDeadWeight('LICENSE.md')).toBe(false);
    expect(isDeadWeight('index.ts')).toBe(false);
    expect(isDeadWeight('index.js')).toBe(false);
  });
});

describe('nodePtyLeftovers', () => {
  it('keeps the loader and only this architecture prebuild', () => {
    expect(
      nodePtyLeftovers(
        [
          'LICENSE',
          'README.md',
          'binding.gyp',
          'deps',
          'lib',
          'package.json',
          'prebuilds',
          'src',
          'third_party',
          'typings',
        ],
        ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'],
        'arm64',
      ),
    ).toEqual([
      'README.md',
      'binding.gyp',
      'deps',
      'src',
      'third_party',
      'typings',
      'prebuilds/darwin-x64',
      'prebuilds/win32-arm64',
      'prebuilds/win32-x64',
    ]);
  });
});

describe('pruneServer', () => {
  it('removes the bundled agent CLIs, other node-pty builds and dead weight', async () => {
    const dir = await tree([
      'src/api/main.ts',
      'node_modules/@openai/codex/bin/codex.js',
      'node_modules/@openai/codex-darwin-x64/vendor/codex',
      'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
      'node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts',
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude',
      'node_modules/@anthropic-ai/sdk/index.js',
      'node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex/bin/codex.js',
      'node_modules/node-pty/package.json',
      'node_modules/node-pty/LICENSE',
      'node_modules/node-pty/README.md',
      'node_modules/node-pty/binding.gyp',
      'node_modules/node-pty/src/unix/pty.cc',
      'node_modules/node-pty/deps/winpty/src/x.cc',
      'node_modules/node-pty/lib/index.js',
      'node_modules/node-pty/lib/index.js.map',
      'node_modules/node-pty/lib/unixTerminal.test.js',
      'node_modules/node-pty/prebuilds/darwin-x64/pty.node',
      'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
      'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      'node_modules/node-pty/prebuilds/win32-x64/conpty.dll',
      'node_modules/zod/LICENSE',
      'node_modules/zod/README.md',
    ]);
    await pruneServer(dir, 'x64');
    expect(await files(dir)).toEqual([
      'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
      'node_modules/@anthropic-ai/sdk/index.js',
      'node_modules/node-pty/LICENSE',
      'node_modules/node-pty/lib/index.js',
      'node_modules/node-pty/package.json',
      'node_modules/node-pty/prebuilds/darwin-x64/pty.node',
      'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
      'node_modules/zod/LICENSE',
      'src/api/main.ts',
    ]);
  });
});

describe('pruneRuntime', () => {
  it('drops the esbuild CLI copy but keeps the platform binary the API runs', async () => {
    const dir = await tree([
      'node_modules/esbuild/bin/esbuild',
      'node_modules/esbuild/lib/main.js',
      'node_modules/@esbuild/darwin-x64/bin/esbuild',
      'node_modules/tsx/dist/loader.mjs.map',
    ]);
    await pruneRuntime(dir);
    expect(await files(dir)).toEqual([
      'node_modules/@esbuild/darwin-x64/bin/esbuild',
      'node_modules/esbuild/lib/main.js',
    ]);
  });
});
