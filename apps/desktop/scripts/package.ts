import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  packagedHeartbeatUrl,
  releaseProblems,
  RELEASE_ARCHS,
  type MacArch,
} from './builder-config.ts';
import { desktopDir, packageDesktop, releaseDir } from './stage.ts';

const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: 'all' },
    version: { type: 'string' },
    release: { type: 'boolean', default: false },
  },
});

function archs(value: string): MacArch[] {
  if (value === 'all') return RELEASE_ARCHS;
  if (value === 'current') return [os.arch() === 'arm64' ? 'arm64' : 'x64'];
  if (value === 'x64' || value === 'arm64') return [value];
  throw new Error(`Unknown --arch ${value}; use all, current, x64 or arm64.`);
}

const manifest = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8')) as {
  version: string;
};
const version = values.version ?? manifest.version;
const targets = archs(values.arch);
if (values.release) {
  const problems = releaseProblems(process.env, targets);
  if (problems.length > 0) {
    console.error(
      `Can't build release ${version}:\n${problems.map((line) => `  - ${line}`).join('\n')}`,
    );
    process.exit(1);
  }
}
const heartbeat = packagedHeartbeatUrl(process.env);
console.log(
  heartbeat ? `Heartbeat: ${heartbeat}` : 'Heartbeat: off (set SPARK_HEARTBEAT_URL to turn it on).',
);
const outputDir = path.join(releaseDir, version);
const artifacts = await packageDesktop({
  version,
  archs: targets,
  outputDir,
  env: process.env,
});
console.log(`Built ${version}:\n${artifacts.map((file) => `  ${file}`).join('\n')}`);
