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
  private setup = new EnvironmentScanner();

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

  environment(): EnvironmentProblem | null {
    this.ids();
    return this.setup.problem();
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
    this.setup.read(line);
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
  setup?: EnvironmentProblem | null;
}

const COMMAND_MISSING = /^\S*sh: .*not found$|Command "[^"]+" not found/m;
const REGISTRY_LOGIN =
  /\bE40[13]\b|ERR_PNPM_FETCH_40[13]|ENEEDAUTH|Unable to authenticate|40[13] (?:Unauthorized|Forbidden)|authentication token|requires? (?:you to )?log ?in|npm (?:login|adduser)/i;
const PACKAGE_TOOL = /registry|npm (?:ERR|error)|ERR_PNPM|YN\d{4}/i;
const OFFLINE =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_NO_OFFLINE|ETIMEDOUT/;
const LOCKFILE =
  /ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_FROZEN_LOCKFILE|ERR_PNPM_LOCKFILE_|`npm ci` can only install|npm (?:ERR!|error) .*package-lock\.json.* in sync|YN0028/i;
const NODE_VERSION =
  /ERR_PNPM_UNSUPPORTED_ENGINE|npm (?:ERR!|error) .*EBADENGINE|engine "node" is incompatible|requires Node(?:\.js)?(?: version)? ?[>=^~v]*\d|Node(?:\.js)? version [^\n]{0,24} is required/i;
const DEPS_MISSING =
  /node_modules missing|did you mean to install\?|ERR_PNPM_NO_IMPORTER_MANIFEST/i;
const UNUSABLE_FLAG =
  /unknown (?:option|argument|flag|command)|unrecognized (?:option|argument)|Unknown arguments?|No projects matched the filters|Cannot find (?:project|configuration for task)/i;

export type EnvironmentProblem =
  'command_missing' | 'registry_login' | 'offline' | 'lockfile' | 'node_version' | 'deps_missing';

function setupProblem(text: string): EnvironmentProblem | null {
  if (REGISTRY_LOGIN.test(text) && PACKAGE_TOOL.test(text)) return 'registry_login';
  if (OFFLINE.test(text) && PACKAGE_TOOL.test(text)) return 'offline';
  if (LOCKFILE.test(text)) return 'lockfile';
  if (NODE_VERSION.test(text)) return 'node_version';
  if (DEPS_MISSING.test(text)) return 'deps_missing';
  return null;
}

const NEARBY_LINES = 3;

class EnvironmentScanner {
  private recent: string[] = [];
  private found: EnvironmentProblem | null = null;

  read(line: string): void {
    if (this.found) return;
    this.recent.push(line);
    if (this.recent.length > NEARBY_LINES) this.recent.shift();
    this.found = setupProblem(this.recent.join('\n'));
  }

  problem(): EnvironmentProblem | null {
    return this.found;
  }
}

export function environmentProblem(run: FinishedCommand): EnvironmentProblem | null {
  const text = run.outputTail;
  const setup = run.setup ?? setupProblem(text);
  if (setup) return setup;
  if (run.exitCode === null || run.exitCode === 127 || COMMAND_MISSING.test(text)) {
    return 'command_missing';
  }
  return null;
}

const ADVICE: Record<Exclude<EnvironmentProblem, 'command_missing'>, string> = {
  registry_login:
    'Your package registry login is missing or has expired where this check runs. Run `npm login` (or your registry’s sign-in), then ask Spark to check again.',
  offline:
    'The package registry could not be reached. Check your connection or VPN, then ask Spark to check again.',
  lockfile:
    'The lockfile does not match the installed dependencies where this check ran. Run an install there, then ask Spark to check again.',
  node_version:
    'The Node.js version this check ran with is not the one the project asks for. Switch to the project’s version, then ask Spark to check again.',
  deps_missing:
    'Dependencies are not installed where this check ran. Install them there, then ask Spark to check again.',
};

export const SAME_SETUP_PROBLEM = 'Same setup problem as the check above.';

export function environmentAdvice(problem: EnvironmentProblem, run: FinishedCommand): string {
  if (problem !== 'command_missing') return ADVICE[problem];
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
