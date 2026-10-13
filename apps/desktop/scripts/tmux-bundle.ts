import { execFile } from 'node:child_process';
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';

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

export const DEPLOYMENT_TARGET = '12.0';

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

const CLANG_ARCH: Record<MacArch, string> = { x64: 'x86_64', arm64: 'arm64' };
const HOST_TRIPLE: Record<MacArch, string> = {
  x64: 'x86_64-apple-darwin',
  arm64: 'aarch64-apple-darwin',
};
const SYSTEM_LIBRARY = /^\/(usr\/lib|System\/Library)\//;

export const clangArch = (arch: MacArch) => CLANG_ARCH[arch];
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

export function foreignLibraries(otoolOutput: string): string[] {
  return otoolOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0] ?? '')
    .filter((name) => name !== '' && !SYSTEM_LIBRARY.test(name));
}

export function binaryProblems(
  arch: MacArch,
  facts: { archs: string; otool: string; minOs: string | null },
): string[] {
  const problems: string[] = [];
  if (facts.archs.trim() !== clangArch(arch))
    problems.push(
      `it is built for ${facts.archs.trim() || 'an unknown CPU'}, not ${clangArch(arch)}`,
    );
  const foreign = foreignLibraries(facts.otool);
  if (foreign.length > 0)
    problems.push(`it links ${foreign.join(', ')}, which a Mac does not ship`);
  if (facts.minOs !== null && Number(facts.minOs) > Number(DEPLOYMENT_TARGET))
    problems.push(`it needs macOS ${facts.minOs}, newer than the app's ${DEPLOYMENT_TARGET}`);
  return problems;
}

export function minimumOs(loadCommands: string): string | null {
  return /^\s*minos (\d+\.\d+)/m.exec(loadCommands)?.[1] ?? null;
}

export async function checkTmuxBinary(binary: string, arch: MacArch): Promise<void> {
  const exists = await stat(binary).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!exists)
    throw new Error(
      `No tmux for ${arch} at ${binary}. Run pnpm desktop:tmux to build it; Terminal sessions need it to survive a restart.`,
    );
  const [archs, otool, commands] = await Promise.all([
    run('lipo', ['-archs', binary]),
    run('otool', ['-L', binary]),
    run('otool', ['-l', binary]),
  ]);
  const problems = binaryProblems(arch, {
    archs: archs.stdout,
    otool: otool.stdout,
    minOs: minimumOs(commands.stdout),
  });
  if (problems.length > 0)
    throw new Error(`The tmux built for ${arch} can't be bundled: ${problems.join('; ')}.`);
  if (arch === 'arm64') await run('codesign', ['--verify', binary]);
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
