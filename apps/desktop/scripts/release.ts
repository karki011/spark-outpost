import { execFile, spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { r2Target, rcloneEnv, rcloneRemote, type R2Target } from './release-target.ts';
import {
  describePlan,
  releasePlan,
  runRelease,
  type ReleaseMode,
  type Uploader,
} from './release-plan.ts';
import { desktopDir, releaseDir } from './stage.ts';

const run = promisify(execFile);

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'beta-only': { type: 'boolean', default: false },
    promote: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

function mode(): ReleaseMode {
  if (values.promote && values['beta-only']) throw new Error('Use --promote or --beta-only.');
  if (values.promote) return 'promote';
  return values['beta-only'] ? 'beta-only' : 'publish';
}

async function localFiles(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  return Promise.all(
    names.map(async (name) => ({ name, size: (await stat(path.join(dir, name))).size })),
  );
}

async function channelTexts(dir: string, names: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8').catch(() => null);
    if (text !== null) texts.set(name, text);
  }
  return texts;
}

function rclone(target: R2Target, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('rclone', args, {
      env: { ...process.env, ...rcloneEnv(target) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`rclone exited with ${code}.`)),
    );
  });
}

function rcloneUploader(target: R2Target, dir: string): Uploader {
  return {
    async list() {
      const { stdout } = await run('rclone', ['lsf', rcloneRemote(target, '')], {
        env: { ...process.env, ...rcloneEnv(target) },
      });
      return stdout.split('\n').filter(Boolean);
    },
    upload: (step) =>
      rclone(target, [
        'copyto',
        path.join(dir, step.source),
        rcloneRemote(target, step.name),
        '--header-upload',
        `Cache-Control: ${step.cacheControl}`,
        '--retries',
        '3',
        '--stats-one-line',
        '-v',
      ]),
  };
}

async function hasRclone(): Promise<boolean> {
  try {
    await run('rclone', ['version']);
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8')) as {
  version: string;
};
const version = values.version ?? manifest.version;
const dir = path.join(releaseDir, version);
const files = await localFiles(dir);
const texts = await channelTexts(dir, ['beta-mac.yml', 'latest-mac.yml']);
const plan = releasePlan({
  version,
  mode: mode(),
  files,
  channelText: (name) => texts.get(name) ?? null,
});
const target = r2Target(process.env);

console.log(describePlan(plan, target.ok ? target.target.label : 'the R2 bucket'));
const problems = [...plan.problems, ...(target.ok ? [] : target.missing)];
if (problems.length > 0) {
  console.error(`\nFix these first:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
}
if (!values.yes) {
  console.log('\nDry run: nothing was uploaded. Add --yes to upload.');
  process.exit(problems.length > 0 ? 1 : 0);
}
if (problems.length > 0 || !target.ok) process.exit(1);
if (!(await hasRclone())) {
  console.error('rclone is not installed. Install it with: brew install rclone');
  process.exit(1);
}
await runRelease(plan, rcloneUploader(target.target, dir), (line) => console.log(line));
