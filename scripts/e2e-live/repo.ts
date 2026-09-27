import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import {
  HIDDEN_DIR,
  createTaskRepo,
  stageAll,
  stagedNumstat,
  type TaskRepo,
} from '../bench/fixture.ts';
import type { BenchTask } from '../bench/tasks.ts';
import {
  judgeVerification,
  outOfScope,
  parseNumstat,
  precheck,
  verifyRepo,
  type Precheck,
  type TestCounts,
  type Verification,
} from '../bench/verify.ts';
import type { ScenarioTask } from './scenarios.ts';

const run = promisify(execFile);
const FIXTURE_TASKS = resolve(import.meta.dirname, '../bench/fixture/tasks');

export async function assertScratchDir(dir: string): Promise<string> {
  await mkdir(resolve(dir), { recursive: true });
  const absolute = await realpath(resolve(dir));
  const roots = await Promise.all([realpath(tmpdir()), realpath('/private/tmp')]);
  if (!roots.some((root) => absolute.startsWith(`${root}${sep}`))) {
    throw new Error(`Scratch repos must live under a temporary folder, not ${absolute}.`);
  }
  return absolute;
}

function asBenchTask(task: ScenarioTask): BenchTask {
  return {
    id: 'T1',
    set: 'standard',
    exercises: '',
    title: '',
    kind: '',
    prompt: '',
    folder: task.folder,
    allowed: task.allowed,
    suiteFailsBefore: task.suiteFailsBefore,
    ...(task.safety ? { safety: true } : {}),
  };
}

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=e2e@spark.local', '-c', 'user.name=e2e', ...args],
    { encoding: 'utf8' },
  );
}

const TYPESCRIPT_VERSION = (
  createRequire(import.meta.url)('typescript/package.json') as { version: string }
).version;

export interface DepsSetup {
  installed: boolean;
  ms: number;
  note: string | null;
}

async function installDependencies(repo: string): Promise<DepsSetup> {
  const started = Date.now();
  const manifestPath = join(repo, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  if (!manifest.devDependencies) {
    manifest.devDependencies = { typescript: TYPESCRIPT_VERSION };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  const failed = await run('pnpm', ['install', '--offline', '--ignore-scripts'], {
    cwd: repo,
    timeout: 180_000,
  }).then(
    () => null,
    (error: Error) => error.message.split('\n')[0] ?? 'pnpm install failed',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'Add dependencies');
  return { installed: failed === null, ms: Date.now() - started, note: failed };
}

async function createPythonRepo(task: ScenarioTask, path: string): Promise<TaskRepo> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  await cp(join(FIXTURE_TASKS, task.folder, 'project'), path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  git(path, 'add', '.');
  git(path, 'commit', '-qm', 'Fixture');
  return { path, base: git(path, 'rev-parse', 'HEAD').trim() };
}

export interface ScenarioRepo {
  repo: TaskRepo;
  before: Precheck | null;
  deps: DepsSetup | null;
}

async function pythonTests(cwd: string, dir: string): Promise<TestCounts | null> {
  const output = await run('python3', ['-m', 'unittest', 'discover', '-s', dir], {
    cwd,
    timeout: 120_000,
  }).then(
    (result) => `${result.stdout}${result.stderr}`,
    (error: { stdout?: string; stderr?: string }) => `${error.stdout ?? ''}${error.stderr ?? ''}`,
  );
  const ran = /^Ran (\d+) tests?/m.exec(output);
  if (!ran) return null;
  const tests = Number(ran[1]);
  const failures = Number(/failures=(\d+)/.exec(output)?.[1] ?? 0);
  const errors = Number(/errors=(\d+)/.exec(output)?.[1] ?? 0);
  return { tests, pass: tests - failures - errors, fail: failures + errors };
}

async function withPythonHidden<T>(task: ScenarioTask, repo: string, work: () => Promise<T>) {
  const target = join(repo, HIDDEN_DIR);
  await cp(join(FIXTURE_TASKS, task.folder, 'hidden'), target, { recursive: true });
  try {
    return await work();
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

async function pythonPrecheck(task: ScenarioTask, repo: TaskRepo): Promise<Precheck> {
  const suite = await pythonTests(repo.path, 'tests');
  const hidden = await withPythonHidden(task, repo.path, () => pythonTests(repo.path, HIDDEN_DIR));
  return { suite, hidden };
}

export async function createScenarioRepo(
  task: ScenarioTask,
  path: string,
  withDeps: boolean,
): Promise<ScenarioRepo> {
  const created = task.python
    ? await createPythonRepo(task, path)
    : await createTaskRepo(asBenchTask(task), path);
  const deps = task.deps || withDeps ? await installDependencies(created.path) : null;
  const repo = deps
    ? { path: created.path, base: git(created.path, 'rev-parse', 'HEAD').trim() }
    : created;
  if (task.verify !== 'tests') return { repo, before: null, deps };
  const before = task.python
    ? await pythonPrecheck(task, repo)
    : await precheck(asBenchTask(task), repo);
  return { repo, before, deps };
}

export interface VerifyContext {
  reply: string;
  asked: boolean;
  cleanup: string[] | null;
}

function base(repo: TaskRepo, reasons: string[], extra: Partial<Verification> = {}): Verification {
  stageAll(repo.path);
  const diff = parseNumstat(stagedNumstat(repo));
  return {
    passed: reasons.length === 0,
    reasons,
    suite: null,
    hidden: null,
    outOfScope: [],
    diff,
    ...extra,
  };
}

async function pythonVerification(
  task: ScenarioTask,
  created: ScenarioRepo,
): Promise<Verification> {
  const { repo } = created;
  stageAll(repo.path);
  const diff = parseNumstat(stagedNumstat(repo));
  const suite = await pythonTests(repo.path, 'tests');
  const hidden = await withPythonHidden(task, repo.path, () => pythonTests(repo.path, HIDDEN_DIR));
  const scope = outOfScope(
    diff.files.filter((file) => !file.includes('__pycache__')),
    task.allowed,
  );
  const judged = judgeVerification({
    precheck: created.before!,
    suiteFailsBefore: task.suiteFailsBefore,
    suite,
    hidden,
    outOfScope: scope,
    diff,
  });
  return { ...judged, suite, hidden, outOfScope: scope, diff };
}

export async function verifyScenario(
  task: ScenarioTask,
  created: ScenarioRepo,
  context: VerifyContext,
): Promise<Verification> {
  const { repo } = created;
  if (task.verify === 'answer') {
    const reasons = (task.answer ?? [])
      .filter((pattern) => !pattern.test(context.reply))
      .map((pattern) => `The reply does not match ${pattern}.`);
    const verification = base(repo, reasons);
    if (verification.diff.files.length > 0) {
      verification.reasons.push(
        `Changed files on a question: ${verification.diff.files.join(', ')}.`,
      );
      verification.passed = false;
    }
    return verification;
  }
  if (task.verify === 'clarify') {
    const reasons = context.asked ? [] : ['No clarifying question was asked before building.'];
    return base(repo, reasons);
  }
  if (task.verify === 'cleanup') return base(repo, context.cleanup ?? ['No cleanup report.']);
  if (task.python) return pythonVerification(task, created);
  return verifyRepo(asBenchTask(task), repo, created.before!);
}
