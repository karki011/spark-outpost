import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  GOOGLE_CLIENT_FILE_ENV,
  MICROSOFT_CLIENT_FILE_ENV,
  packagedHeartbeatUrl,
  packagedShareUrl,
  packagedSlackClientId,
  releaseProblems,
  RELEASE_ARCHS,
  type BuildPlatform,
  type MacArch,
} from './builder-config.ts';
import { desktopDir, packageDesktop, releaseDir } from './stage.ts';

const { values } = parseArgs({
  options: {
    arch: { type: 'string', default: 'all' },
    version: { type: 'string' },
    release: { type: 'boolean', default: false },
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
    throw new Error('Windows builds are x64 only: Postgres has no Windows arm64 build.');
  }
  if (value === 'all') return RELEASE_ARCHS;
  if (value === 'current') return [os.arch() === 'arm64' ? 'arm64' : 'x64'];
  if (value === 'x64' || value === 'arm64') return [value];
  throw new Error(`Unknown --arch ${value}; use all, current, x64 or arm64.`);
}

function localClientFile(name: string): string | undefined {
  const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: desktopDir,
    encoding: 'utf8',
  }).trim();
  const roots = [path.resolve(desktopDir, '../..'), path.dirname(gitDir)];
  return roots.map((root) => path.join(root, '.local', name)).find((file) => existsSync(file));
}

for (const [env, name] of [
  [GOOGLE_CLIENT_FILE_ENV, 'google-oauth-client.json'],
  [MICROSOFT_CLIENT_FILE_ENV, 'microsoft-oauth-client.json'],
] as const) {
  if ((process.env[env] ?? '').trim() !== '') continue;
  const found = localClientFile(name);
  if (found) process.env[env] = found;
}

const manifest = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8')) as {
  version: string;
};
const version = values.version ?? manifest.version;
const targets = archs(values.arch);
if (values.release && platform === 'win') {
  console.error(
    "Can't build a Windows release yet: Authenticode signing and a Windows update feed are not set up. Leave out --release for an unsigned test build.",
  );
  process.exit(1);
}
if (values.release) {
  const problems = releaseProblems(process.env, targets);
  if (problems.length > 0) {
    console.error(
      `Can't build release ${version}:\n${problems.map((line) => `  - ${line}`).join('\n')}`,
    );
    process.exit(1);
  }
}
console.log(
  `Google Calendar: ${process.env[GOOGLE_CLIENT_FILE_ENV] ? 'on' : `off (set ${GOOGLE_CLIENT_FILE_ENV})`}`,
);
console.log(
  `Microsoft Calendar: ${process.env[MICROSOFT_CLIENT_FILE_ENV] ? 'on' : `off (set ${MICROSOFT_CLIENT_FILE_ENV})`}`,
);
console.log(`Slack: ${packagedSlackClientId(process.env) ? 'on' : 'off'}`);
const heartbeat = packagedHeartbeatUrl(process.env);
console.log(
  heartbeat ? `Heartbeat: ${heartbeat}` : 'Heartbeat: off (set SPARK_HEARTBEAT_URL to turn it on).',
);
const share = packagedShareUrl(process.env);
console.log(share ? `Share: ${share}` : 'Share: off (set SPARK_SHARE_URL to turn it on).');
const outputDir = path.join(releaseDir, version);
const artifacts = await packageDesktop({
  version,
  archs: targets,
  platform,
  outputDir,
  env: process.env,
});
console.log(`Built ${version}:\n${artifacts.map((file) => `  ${file}`).join('\n')}`);
