import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

const MAX_FAILURES = 100;
const TEST_FILE = /^\s*(?:FAIL|❯|×|✗)\s+(?:\|[^|]+\|\s+)?(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b/;
const TSC_LINE = /^(\S+?)\(\d+,\d+\): error (TS\d+)/;
const TSC_PRETTY = /^(\S+?):\d+:\d+ - error (TS\d+)/;
const NX_FAILED_RUN = /^\s*[✖×]\s+(?:nx run\s+)?([\w@./-]+:[\w:.-]+)\s*$/;
const NX_LIST_ITEM = /^\s*-\s+([\w@./-]+:[\w:.-]+)\s*$/;
const NX_LIST_HEAD = /Failed tasks:/;
const TURBO_FAILED = /([\w@./-]+#[\w:.-]+): (?:command .*)?exited \(\d+\)/;
const TURBO_LIST = /^\s*Failed:\s+([\w@./-]+#[\w:.-]+)/;
const LINT_FILE = /^(\S+\.[cm]?[jt]sx?)$/;
const LINT_ERROR = /^\s+\d+:\d+\s+error\s/;

export class FailureScanner {
  private rest = '';
  private found = new Set<string>();
  private inNxList = false;
  private lintFile: string | null = null;

  constructor(private readonly roots: readonly string[] = []) {}

  push(chunk: Buffer | string): void {
    const lines = (this.rest + chunk.toString()).split('\n');
    this.rest = lines.pop() ?? '';
    for (const line of lines) this.read(line);
  }

  ids(): string[] {
    if (this.rest) {
      this.read(this.rest);
      this.rest = '';
    }
    return [...this.found].sort();
  }

  private add(id: string): void {
    if (this.found.size < MAX_FAILURES) this.found.add(id);
  }

  private local(file: string): string {
    const root = this.roots.find((candidate) => file.startsWith(`${candidate}/`));
    return root ? file.slice(root.length + 1) : file.replace(/^\.\//, '');
  }

  private read(raw: string): void {
    const line = stripVTControlCharacters(raw).replace(/\r$/, '');
    const test = TEST_FILE.exec(line);
    if (test) this.add(`test ${this.local(test[1]!)}`);
    const type = TSC_LINE.exec(line) ?? TSC_PRETTY.exec(line);
    if (type) this.add(`type ${this.local(type[1]!)} ${type[2]!}`);
    const task = NX_FAILED_RUN.exec(line) ?? TURBO_FAILED.exec(line) ?? TURBO_LIST.exec(line);
    if (task) this.add(`task ${task[1]!}`);
    if (NX_LIST_HEAD.test(line)) this.inNxList = true;
    else if (this.inNxList) {
      const item = NX_LIST_ITEM.exec(line);
      if (item) this.add(`task ${item[1]!}`);
      else if (line.trim() !== '') this.inNxList = false;
    }
    const file = LINT_FILE.exec(line.trim());
    if (file && line === line.trimStart()) this.lintFile = this.local(file[1]!);
    else if (this.lintFile && LINT_ERROR.test(line)) this.add(`lint ${this.lintFile}`);
    else if (line.trim() === '') this.lintFile = null;
  }
}

export function failureIds(text: string, roots: readonly string[] = []): string[] {
  const scanner = new FailureScanner(roots);
  scanner.push(text);
  return scanner.ids();
}

export interface FinishedCommand {
  argv: readonly string[];
  exitCode: number | null;
  outputTail: string;
}

const COMMAND_MISSING = /^\S*sh: .*not found$|Command "[^"]+" not found/m;
const REGISTRY_LOGIN =
  /\bE401\b|ERR_PNPM_FETCH_40[13]|ENEEDAUTH|Unable to authenticate|401 Unauthorized|authentication token|requires? (?:you to )?log ?in|npm (?:login|adduser)/i;
const PACKAGE_TOOL = /registry|npm (?:ERR|error)|ERR_PNPM|YN\d{4}/i;
const OFFLINE =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_NO_OFFLINE|ETIMEDOUT/;
const DEPS_MISSING =
  /node_modules missing|did you mean to install\?|ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_NO_IMPORTER_MANIFEST/i;
const UNUSABLE_FLAG =
  /unknown (?:option|argument|flag|command)|unrecognized (?:option|argument)|Unknown arguments?|No projects matched the filters|Cannot find (?:project|configuration for task)/i;

export type EnvironmentProblem = 'command_missing' | 'registry_login' | 'offline' | 'deps_missing';

export function environmentProblem(run: FinishedCommand): EnvironmentProblem | null {
  const text = run.outputTail;
  if (REGISTRY_LOGIN.test(text) && PACKAGE_TOOL.test(text)) return 'registry_login';
  if (OFFLINE.test(text) && PACKAGE_TOOL.test(text)) return 'offline';
  if (DEPS_MISSING.test(text)) return 'deps_missing';
  if (run.exitCode === null || run.exitCode === 127 || COMMAND_MISSING.test(text)) {
    return 'command_missing';
  }
  return null;
}

export function environmentAdvice(problem: EnvironmentProblem, run: FinishedCommand): string {
  if (problem === 'registry_login') {
    return 'Your package registry login is missing or has expired. Run `npm login` (or your registry’s sign-in), then ask Spark to check again.';
  }
  if (problem === 'offline') {
    return 'The package registry could not be reached. Check your connection or VPN, then ask Spark to check again.';
  }
  if (problem === 'deps_missing') {
    return 'Dependencies are not installed where this check ran. Install them there, then ask Spark to check again.';
  }
  const missing = /Command "([^"]+)" not found/.exec(run.outputTail)?.[1] ?? run.argv[0] ?? 'it';
  return `\`${missing}\` was not found on this computer. Install it, or set this project’s check commands in Settings > Projects.`;
}

export function unusableScopedForm(run: FinishedCommand): boolean {
  return environmentProblem(run) === 'command_missing' || UNUSABLE_FLAG.test(run.outputTail);
}

export function failureSignature(
  command: string,
  failures: readonly string[],
  exitCode: number | null,
) {
  const what = failures.length > 0 ? [...failures].sort().join(',') : `exit ${exitCode ?? '?'}`;
  return `${command}\n${what}`;
}

const SHAPE_TAIL = 2_000;

export function outputShape(text: string, roots: readonly string[] = []): string {
  const local = roots.reduce((shown, root) => shown.replaceAll(root, '.'), text);
  const steady = stripVTControlCharacters(local)
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(steady.slice(-SHAPE_TAIL)).digest('hex');
}

export interface FailedOutput {
  failures: readonly string[];
  shape: string;
}

export interface Comparison {
  shared: string[];
  added: string[];
  fromChange: boolean;
}

export function compareWithBase(
  change: FailedOutput,
  base: FailedOutput & { passed: boolean },
): Comparison {
  if (base.passed) return { shared: [], added: [...change.failures], fromChange: true };
  const before = new Set(base.failures);
  const shared = change.failures.filter((id) => before.has(id));
  const added = change.failures.filter((id) => !before.has(id));
  const named = change.failures.length > 0;
  return { shared, added, fromChange: named ? added.length > 0 : change.shape !== base.shape };
}
