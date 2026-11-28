import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CLOUDFLARED_MIN_MACOS } from '../src/cloudflared.ts';
import type { MacArch } from './builder-config.ts';
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

export const CLOUDFLARED_LICENCE: PinnedFile = {
  url: `https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE`,
  sha256: '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd',
};

export const CLOUDFLARED_LICENCE_FILE = 'cloudflared-LICENSE.txt';

export function cloudflaredBuiltDir(repoRoot: string, arch: MacArch): string {
  return path.join(repoRoot, '.local/cloudflared', arch);
}

export function cloudflaredStamp(arch: MacArch): string {
  return `${CLOUDFLARED[arch].sha256}\n${CLOUDFLARED_LICENCE.sha256}`;
}

export async function checkCloudflaredBinary(binary: string, arch: MacArch): Promise<void> {
  await checkBundledBinary({
    name: 'cloudflared',
    path: binary,
    arch,
    target: CLOUDFLARED_MIN_MACOS,
    missing:
      'Run pnpm desktop:cloudflared to download it; Remote control needs it to reach this computer through Cloudflare.',
  });
}

async function pinned(file: PinnedFile): Promise<Buffer> {
  console.log(`Downloading ${file.url}`);
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Could not download ${file.url} (${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== file.sha256)
    throw new Error(`${file.url} has sha256 ${sha256}; the pinned one is ${file.sha256}.`);
  return data;
}

async function isCurrent(built: string, arch: MacArch): Promise<boolean> {
  const stamp = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (stamp !== cloudflaredStamp(arch)) return false;
  return checkCloudflaredBinary(path.join(built, 'bin/cloudflared'), arch).then(
    () => true,
    () => false,
  );
}

export async function buildCloudflared(repoRoot: string, arch: MacArch): Promise<string> {
  const built = cloudflaredBuiltDir(repoRoot, arch);
  const binary = path.join(built, 'bin/cloudflared');
  if (!(await isCurrent(built, arch))) {
    await rm(built, { recursive: true, force: true });
    await mkdir(path.join(built, 'bin'), { recursive: true });
    await mkdir(path.join(built, 'licenses'), { recursive: true });
    const archive = path.join(built, 'cloudflared.tgz');
    await writeFile(archive, await pinned(CLOUDFLARED[arch]));
    await run('tar', ['-xzf', archive, '-C', path.join(built, 'bin'), 'cloudflared']);
    await rm(archive);
    await writeFile(
      path.join(built, 'licenses', CLOUDFLARED_LICENCE_FILE),
      await pinned(CLOUDFLARED_LICENCE),
    );
    await writeFile(path.join(built, 'stamp'), cloudflaredStamp(arch));
  }
  await checkCloudflaredBinary(binary, arch);
  if (arch === os.arch()) await checkCloudflaredStarts(binary);
  return built;
}

export async function checkCloudflaredStarts(binary: string): Promise<void> {
  const { stdout } = await run('/usr/bin/env', ['-i', binary, '--version']);
  if (!stdout.includes(CLOUDFLARED_VERSION))
    throw new Error(
      `The bundled cloudflared printed "${stdout.trim()}", not ${CLOUDFLARED_VERSION}.`,
    );
}

export async function stageCloudflared(
  builtDir: string,
  arch: MacArch,
  resources: string,
): Promise<void> {
  await checkCloudflaredBinary(path.join(builtDir, 'bin/cloudflared'), arch);
  const target = path.join(resources, 'cloudflared');
  await mkdir(path.join(target, 'bin'), { recursive: true });
  await cp(path.join(builtDir, 'bin/cloudflared'), path.join(target, 'bin/cloudflared'));
  await cp(
    path.join(builtDir, 'licenses', CLOUDFLARED_LICENCE_FILE),
    path.join(target, 'licenses', CLOUDFLARED_LICENCE_FILE),
  );
}
