import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RELEASE_ARCHS, type BuildPlatform, type MacArch } from './builder-config.ts';
import { buildCloudflared } from './cloudflared-bundle.ts';
const repoRoot = path.resolve(import.meta.dirname, '../../..');

const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: 'current' },
    platform: { type: 'string', default: process.platform === 'win32' ? 'win' : 'mac' },
  },
});

function buildPlatform(value: string): BuildPlatform {
  if (value === 'mac' || value === 'win') return value;
  throw new Error(`Unknown --platform ${value}; use mac or win.`);
}

const platform = buildPlatform(values.platform);

function archs(value: string): MacArch[] {
  if (platform === 'win') {
    if (value === 'all' || value === 'current' || value === 'x64') return ['x64'];
    throw new Error('The Windows cloudflared is bundled for x64 only.');
  }
  if (value === 'all') return RELEASE_ARCHS;
  if (value === 'current') return [os.arch() === 'arm64' ? 'arm64' : 'x64'];
  if (value === 'x64' || value === 'arm64') return [value];
  throw new Error(`Unknown --arch ${value}; use all, current, x64 or arm64.`);
}

for (const arch of archs(values.arch))
  console.log(
    `cloudflared for ${platform} ${arch}: ${await buildCloudflared(repoRoot, arch, platform)}`,
  );
