import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_PNPM = (log: string) => `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [verb, ...rest] = process.argv.slice(2);
const cwd = process.cwd();
const env = { ...process.env, PATH: path.join(cwd, 'tools', 'bin') + ':' + process.env.PATH };
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) {
    console.error('ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "' + command + '" not found');
    process.exit(254);
  }
  process.exit(result.status ?? 1);
};
if (verb === 'install') {
  appendFileSync(${JSON.stringify(log)}, path.basename(cwd) + ' ' + rest.join(' ') + '\\n');
  if (existsSync(path.join(cwd, 'tools', 'install-fails'))) {
    console.error('ERR_PNPM_FETCH_401  GET https://registry.example.test/left-pad: Unauthorized - 401');
    process.exit(1);
  }
  mkdirSync(path.join(cwd, 'node_modules'), { recursive: true });
  writeFileSync(path.join(cwd, 'node_modules', '.lock'), readFileSync(path.join(cwd, 'pnpm-lock.yaml')));
  process.exit(0);
}
if (verb === 'run') {
  const scripts = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts;
  run('sh', ['-c', scripts[rest[0]] + ' ' + rest.slice(1).join(' ')]);
}
if (verb === 'exec') run(rest[0], rest.slice(1));
process.exit(1);
`;

const FAKE_NX = `#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [sub, ...args] = process.argv.slice(2);
const cwd = process.cwd();
if (sub === 'affected' && existsSync(path.join(cwd, 'tools', 'no-affected'))) {
  console.error('Unknown arguments: affected');
  process.exit(1);
}
const target = args[args.indexOf('-t') + 1];
const files = args.find((arg) => arg.startsWith('--files='))?.slice(8).split(',') ?? null;
const script = path.join(cwd, 'tools', target + '.mjs');
if (!existsSync(script)) {
  console.log('nx ' + sub + ' ' + target + ': ok');
  process.exit(0);
}
const { default: run } = await import(pathToFileURL(script).href);
process.exit((await run({ sub, files, cwd })) ?? 0);
`;

export const OLD_TYPE_ERROR = `export default function run() {
  console.log('libs/legacy/src/old.ts(3,1): error TS2322: an old problem');
  console.log('Failed tasks:\\n\\n- design-system-mcp:build\\n');
  return 1;
}
`;

export const TESTS_FAIL_AFTER_CHANGE = `import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export default async function run({ sub, cwd }) {
  if (sub === 'run-many') await new Promise((resolve) => setTimeout(resolve, 60_000));
  console.log(' FAIL  libs/dashboards/api/src/dashboards-api.test.ts > loads');
  const changed = readFileSync(path.join(cwd, 'notes.txt'), 'utf8').includes('step');
  if (changed && !existsSync(path.join(cwd, 'fixed.txt'))) {
    console.log(' FAIL  libs/a/src/a.test.ts > keeps notes');
  }
  return 1;
}
`;

export const OLD_TEST_FAILURE = `export default async function run() {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  console.log(' FAIL  libs/features/dashboards/api/src/__tests__/dashboards-api.test.ts > loads');
  return 1;
}
`;

export const WHOLE_REPO_IS_SLOW = `export default async function run({ sub }) {
  if (sub === 'run-many') await new Promise((resolve) => setTimeout(resolve, 60_000));
  console.log('tests ok');
  return 0;
}
`;

export interface CheckFixture {
  root: string;
  installs(): Promise<string[]>;
  commit(files: Record<string, string>): Promise<void>;
  remove(): Promise<void>;
}

async function put(root: string, file: string, text: string, mode = 0o644): Promise<void> {
  const target = join(root, file);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, text);
  await chmod(target, mode);
}

export async function nxWorkspace(tools: Record<string, string> = {}): Promise<CheckFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-nx-fixture-')));
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'spark-fake-pnpm-')));
  const log = join(outside, 'installs.log');
  await put(outside, 'pnpm', FAKE_PNPM(log), 0o755);
  const manifest = {
    name: 'fixture',
    packageManager: 'pnpm@9.0.0',
    scripts: {
      typecheck: 'nx run-many -t typecheck',
      lint: 'nx run-many -t lint',
      test: 'nx run-many -t test',
    },
  };
  await put(root, 'package.json', JSON.stringify(manifest, null, 2));
  await put(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  await put(root, 'pnpm-workspace.yaml', 'packages:\n  - libs/*\n');
  await put(root, 'nx.json', '{}\n');
  await put(root, '.gitignore', 'node_modules\n');
  await put(root, 'libs/a/package.json', '{"name":"a"}\n');
  await put(root, 'notes.txt', 'start\n');
  await put(root, 'tools/bin/nx', FAKE_NX, 0o755);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  const commit = async (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) await put(root, file, text);
    git('add', '.');
    git('commit', '-qm', 'fixture');
  };
  git('init', '-q');
  await commit(
    Object.fromEntries(Object.entries(tools).map(([name, text]) => [`tools/${name}`, text])),
  );
  const before = process.env.PATH;
  process.env.PATH = `${outside}:${before}`;
  return {
    root,
    commit,
    installs: async () =>
      (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((line) => line !== ''),
    remove: async () => {
      process.env.PATH = before;
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
}
