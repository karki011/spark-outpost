import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CLOUDFLARED_MIN_MACOS, cloudflaredFile, cloudflaredFolder } from '../src/cloudflared.ts';
import type { BuildPlatform, MacArch } from './builder-config.ts';
import { checkBundledBinary } from './bundled-binary.ts';

const run = promisify(execFile);

export interface PinnedFile {
  url: string;
  sha256: string;
}

export const CLOUDFLARED_VERSION = '2026.11.2';
const RELEASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

export const CLOUDFLARED: Record<MacArch, PinnedFile> = {
  arm64: {
    url: `${RELEASE}/cloudflared-darwin-arm64.tgz`,
    sha256: 'f6d58eeec91ad1ec5fd1f7e4a587303772929b2625be5d24068033851c36ff55',
  },
  x64: {
    url: `${RELEASE}/cloudflared-darwin-amd64.tgz`,
    sha256: '6153d9ec629174882a3adbff2f7dc5a24b4f3bdd7ccc38eaa84fba26eb890311',
  },
};

export const CLOUDFLARED_WINDOWS: PinnedFile = {
  url: `${RELEASE}/cloudflared-windows-amd64.exe`,
  sha256: '555b46c85582461d189cac30d14ad05480d612613801be9f110b8ce08c5b2113',
};

export const CLOUDFLARED_LICENCE: PinnedFile = {
  url: `https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE`,
  sha256: '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd',
};

export const CLOUDFLARED_LICENCE_FILE = 'cloudflared-LICENSE.txt';

const MISSING =
  'Run pnpm desktop:cloudflared to download it; Remote control needs it to reach this computer through Cloudflare.';

const nodePlatform = (platform: BuildPlatform): NodeJS.Platform =>
  platform === 'win' ? 'win32' : 'darwin';

export function cloudflaredBinaryPath(platform: BuildPlatform = 'mac'): string {
  return path.join('bin', cloudflaredFile(nodePlatform(platform)));
}

export function cloudflaredPinned(arch: MacArch, platform: BuildPlatform = 'mac'): PinnedFile {
  if (platform === 'mac') return CLOUDFLARED[arch];
  if (arch !== 'x64') throw new Error('The Windows cloudflared is bundled for x64 only.');
  return CLOUDFLARED_WINDOWS;
}

export function cloudflaredBuiltDir(
  repoRoot: string,
  arch: MacArch,
  platform: BuildPlatform = 'mac',
): string {
  return path.join(repoRoot, '.local/cloudflared', cloudflaredFolder(nodePlatform(platform), arch));
}

export function cloudflaredStamp(arch: MacArch, platform: BuildPlatform = 'mac'): string {
  return `${cloudflaredPinned(arch, platform).sha256}\n${CLOUDFLARED_LICENCE.sha256}`;
}

const sha256Of = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function windowsBinaryProblem(data: Buffer | null): string | null {
  if (data === null) return `it is missing. ${MISSING}`;
  const sha256 = sha256Of(data);
  if (sha256 === CLOUDFLARED_WINDOWS.sha256) return null;
  return `it has sha256 ${sha256}; the pinned one is ${CLOUDFLARED_WINDOWS.sha256}`;
}

export async function checkCloudflaredBinary(
  binary: string,
  arch: MacArch,
  platform: BuildPlatform = 'mac',
): Promise<void> {
  if (platform === 'win') {
    cloudflaredPinned(arch, platform);
    const problem = windowsBinaryProblem(await readFile(binary).catch(() => null));
    if (problem)
      throw new Error(`The Windows cloudflared at ${binary} can't be bundled: ${problem}.`);
    return;
  }
  await checkBundledBinary({
    name: 'cloudflared',
    path: binary,
    arch,
    target: CLOUDFLARED_MIN_MACOS,
    missing: MISSING,
  });
}

async function pinned(file: PinnedFile): Promise<Buffer> {
  console.log(`Downloading ${file.url}`);
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Could not download ${file.url} (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = sha256Of(data);
  if (sha256 !== file.sha256)
    throw new Error(`${file.url} has sha256 ${sha256}; the pinned one is ${file.sha256}.`);
  return data;
}

async function isCurrent(built: string, arch: MacArch, platform: BuildPlatform): Promise<boolean> {
  const stamp = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (stamp !== cloudflaredStamp(arch, platform)) return false;
  return checkCloudflaredBinary(
    path.join(built, cloudflaredBinaryPath(platform)),
    arch,
    platform,
  ).then(
    () => true,
    () => false,
  );
}

async function unpackMac(built: string, arch: MacArch): Promise<void> {
  const archive = path.join(built, 'cloudflared.tgz');
  await writeFile(archive, await pinned(CLOUDFLARED[arch]));
  await run('tar', ['-xzf', archive, '-C', path.join(built, 'bin'), 'cloudflared']);
  await rm(archive);
}

export async function buildCloudflared(
  repoRoot: string,
  arch: MacArch,
  platform: BuildPlatform = 'mac',
): Promise<string> {
  const built = cloudflaredBuiltDir(repoRoot, arch, platform);
  const binary = path.join(built, cloudflaredBinaryPath(platform));
  if (!(await isCurrent(built, arch, platform))) {
    await rm(built, { recursive: true, force: true });
    await mkdir(path.join(built, 'bin'), { recursive: true });
    await mkdir(path.join(built, 'licenses'), { recursive: true });
    if (platform === 'win')
      await writeFile(binary, await pinned(cloudflaredPinned(arch, platform)));
    else await unpackMac(built, arch);
    await writeFile(
      path.join(built, 'licenses', CLOUDFLARED_LICENCE_FILE),
      await pinned(CLOUDFLARED_LICENCE),
    );
    await writeFile(path.join(built, 'stamp'), cloudflaredStamp(arch, platform));
  }
  await checkCloudflaredBinary(binary, arch, platform);
  if (process.platform === nodePlatform(platform) && arch === os.arch())
    await checkCloudflaredStarts(binary);
  return built;
}

export async function checkCloudflaredStarts(binary: string): Promise<void> {
  const { stdout } =
    process.platform === 'win32'
      ? await run(binary, ['--version'], {
          env: { SystemRoot: process.env.SystemRoot },
          windowsHide: true,
        })
      : await run('/usr/bin/env', ['-i', binary, '--version']);
  if (!stdout.includes(CLOUDFLARED_VERSION))
    throw new Error(
      `The bundled cloudflared printed "${stdout.trim()}", not ${CLOUDFLARED_VERSION}.`,
    );
}

export async function stageCloudflared(
  builtDir: string,
  arch: MacArch,
  resources: string,
  platform: BuildPlatform = 'mac',
): Promise<void> {
  const binary = cloudflaredBinaryPath(platform);
  await checkCloudflaredBinary(path.join(builtDir, binary), arch, platform);
  const target = path.join(resources, 'cloudflared');
  await mkdir(path.join(target, 'bin'), { recursive: true });
  await cp(path.join(builtDir, binary), path.join(target, binary));
  await cp(
    path.join(builtDir, 'licenses', CLOUDFLARED_LICENCE_FILE),
    path.join(target, 'licenses', CLOUDFLARED_LICENCE_FILE),
  );
}
