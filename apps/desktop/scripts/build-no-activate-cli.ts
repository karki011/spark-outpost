import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RELEASE_ARCHS, type MacArch } from './builder-config.ts';
import { buildNoActivate } from './no-activate-bundle.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const { values } = parseArgs({ options: { arch: { type: 'string', default: 'current' } } });

function archs(value: string): MacArch[] {
  if (value === 'all') return RELEASE_ARCHS;
  if (value === 'current') return [os.arch() === 'arm64' ? 'arm64' : 'x64'];
  if (value === 'x64' || value === 'arm64') return [value];
  throw new Error(`Unknown --arch ${value}; use all, current, x64 or arm64.`);
}

for (const arch of archs(values.arch))
  console.log(`No-activate addon for ${arch}: ${await buildNoActivate(repoRoot, arch)}`);
