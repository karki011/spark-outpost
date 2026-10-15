import { execFile } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';
import { checkBundledBinary } from './bundled-binary.ts';

const run = promisify(execFile);

export interface TmuxSource {
  name: string;
  version: string;
  file: string;
  folder: string;
  url: string;
  sha256: string;
  licence: string;
}

export const TMUX: TmuxSource = {
  name: 'tmux',
  version: '3.8',
  file: 'tmux-3.8.tar.gz',
  folder: 'tmux-3.8',
  url: 'https://github.com/tmux/tmux/releases/download/3.8/tmux-3.8.tar.gz',
  sha256: 'e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e',
  licence: 'COPYING',
};

export const LIBEVENT: TmuxSource = {
  name: 'libevent',
  version: '2.1.13-stable',
  file: 'libevent-2.1.13-stable.tar.gz',
  folder: 'libevent-2.1.13-stable',
  url: 'https://github.com/libevent/libevent/releases/download/release-2.1.13-stable/libevent-2.1.13-stable.tar.gz',
  sha256: 'f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c',
  licence: 'LICENSE',
};

export const TMUX_LICENCES = ['tmux-COPYING.txt', 'libevent-LICENSE.txt'];

const HOST_TRIPLE: Record<MacArch, string> = {
  x64: 'x86_64-apple-darwin',
  arm64: 'aarch64-apple-darwin',
};

export const hostTriple = (arch: MacArch) => HOST_TRIPLE[arch];

export function tmuxStamp(): string {
  return [TMUX, LIBEVENT].map((source) => `${source.name} ${source.sha256}`).join('\n');
}

export function tmuxCacheDir(repoRoot: string): string {
  return path.join(repoRoot, '.local/tmux');
}

export function tmuxBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(tmuxCacheDir(repoRoot), arch);
}

export async function checkTmuxBinary(binary: string, arch: MacArch): Promise<void> {
  await checkBundledBinary({
    name: 'tmux',
    path: binary,
    arch,
    missing: 'Run pnpm desktop:tmux to build it; Terminal sessions need it to survive a restart.',
  });
}

export async function checkTmuxStarts(binary: string): Promise<void> {
  const { stdout } = await run('/usr/bin/env', ['-i', binary, '-V']);
  if (!stdout.startsWith(`tmux ${TMUX.version}`))
    throw new Error(`The bundled tmux printed "${stdout.trim()}", not tmux ${TMUX.version}.`);
}

export async function stageTmux(builtDir: string, arch: MacArch, resources: string): Promise<void> {
  await checkTmuxBinary(path.join(builtDir, 'bin/tmux'), arch);
  const target = path.join(resources, 'tmux');
  await mkdir(path.join(target, 'bin'), { recursive: true });
  await cp(path.join(builtDir, 'bin/tmux'), path.join(target, 'bin/tmux'));
  for (const licence of TMUX_LICENCES)
    await cp(path.join(builtDir, 'licenses', licence), path.join(target, 'licenses', licence));
}
