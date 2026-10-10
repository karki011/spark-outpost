import { mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WORKTREE_ROOT } from '../paths.ts';

const PACKAGES = ['typescript', 'eslint', 'typescript-eslint', '@types/node'] as const;
const BINS = { tsc: 'typescript/bin/tsc', eslint: 'eslint/bin/eslint.js' } as const;

export interface Toolchain {
  tsc: string;
  eslint: string;
}

async function link(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { recursive: true, force: true });
  await symlink(target, path);
}

export function toolchainOf(base: string): Toolchain {
  const modules = join(base, 'node_modules');
  return { tsc: join(modules, BINS.tsc), eslint: join(modules, BINS.eslint) };
}

export async function linkToolchain(base: string): Promise<Toolchain> {
  const modules = join(base, 'node_modules');
  for (const name of PACKAGES) {
    await link(await realpath(join(WORKTREE_ROOT, 'node_modules', name)), join(modules, name));
  }
  for (const [bin, script] of Object.entries(BINS)) {
    await link(join(modules, script), join(modules, '.bin', bin));
  }
  return toolchainOf(base);
}
