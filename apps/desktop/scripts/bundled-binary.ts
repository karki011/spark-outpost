import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';

const run = promisify(execFile);

export const DEPLOYMENT_TARGET = '12.0';

const CLANG_ARCH: Record<MacArch, string> = { x64: 'x86_64', arm64: 'arm64' };
const SYSTEM_LIBRARY = /^\/(usr\/lib|System\/Library)\//;

export const clangArch = (arch: MacArch) => CLANG_ARCH[arch];

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

export interface BundledBinary {
  name: string;
  path: string;
  arch: MacArch;
  missing: string;
}

export async function checkBundledBinary(binary: BundledBinary): Promise<void> {
  const { name, path, arch } = binary;
  const exists = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!exists) throw new Error(`No ${name} for ${arch} at ${path}. ${binary.missing}`);
  const [archs, otool, commands] = await Promise.all([
    run('lipo', ['-archs', path]),
    run('otool', ['-L', path]),
    run('otool', ['-l', path]),
  ]);
  const problems = binaryProblems(arch, {
    archs: archs.stdout,
    otool: otool.stdout,
    minOs: minimumOs(commands.stdout),
  });
  if (problems.length > 0)
    throw new Error(`The ${name} built for ${arch} can't be bundled: ${problems.join('; ')}.`);
  if (arch === 'arm64') await run('codesign', ['--verify', path]);
}
