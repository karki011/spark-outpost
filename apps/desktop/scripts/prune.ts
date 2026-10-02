import { glob, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { MacArch } from './builder-config.ts';

export const BUNDLED_AGENT_CLIS = [
  'node_modules/**/@openai/codex',
  'node_modules/**/@openai/codex-*',
  'node_modules/**/@anthropic-ai/claude-agent-sdk-*',
];

const DEAD_WEIGHT = /\.(map|d\.ts|d\.mts|d\.cts|md|markdown)$/i;
const KEPT_NOTICE = /^(licen[cs]e|notice|copying)/i;

export function isDeadWeight(file: string): boolean {
  const name = path.basename(file);
  return DEAD_WEIGHT.test(name) && !KEPT_NOTICE.test(name);
}

const NODE_PTY_ENTRIES = new Set(['package.json', 'LICENSE', 'lib', 'prebuilds']);

export function nodePtyLeftovers(entries: string[], prebuilds: string[], arch: MacArch): string[] {
  const kept = `darwin-${arch}`;
  return [
    ...entries.filter((entry) => !NODE_PTY_ENTRIES.has(entry)),
    ...prebuilds.filter((entry) => entry !== kept).map((entry) => `prebuilds/${entry}`),
  ];
}

export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of items) collected.push(item);
  return collected;
}

async function removeMatches(root: string, patterns: string[]): Promise<void> {
  const matches = await collect(glob(patterns, { cwd: root }));
  for (const match of matches) await rm(path.join(root, match), { recursive: true, force: true });
}

async function removeDeadWeight(root: string): Promise<void> {
  const entries = await collect(glob('node_modules/**/*', { cwd: root, withFileTypes: true }));
  for (const entry of entries) {
    if (entry.isFile() && isDeadWeight(entry.name)) {
      await rm(path.resolve(root, entry.parentPath, entry.name), { force: true });
    }
  }
}

async function pruneNodePty(serverDir: string, arch: MacArch): Promise<void> {
  const ptyDir = path.join(serverDir, 'node_modules/node-pty');
  const leftovers = nodePtyLeftovers(
    await readdir(ptyDir),
    await readdir(path.join(ptyDir, 'prebuilds')),
    arch,
  );
  for (const leftover of leftovers) {
    await rm(path.join(ptyDir, leftover), { recursive: true, force: true });
  }
  await removeMatches(ptyDir, ['lib/**/*.test.js']);
}

export async function pruneServer(serverDir: string, arch: MacArch): Promise<void> {
  await removeMatches(serverDir, BUNDLED_AGENT_CLIS);
  await pruneNodePty(serverDir, arch);
  await removeDeadWeight(serverDir);
}

export async function pruneRuntime(runtimeDir: string): Promise<void> {
  await rm(path.join(runtimeDir, 'node_modules/esbuild/bin/esbuild'), { force: true });
  await removeDeadWeight(runtimeDir);
}
