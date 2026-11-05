import { stripVTControlCharacters } from 'node:util';

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

class NearbyLines {
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

export class SetupScanner {
  private rest = '';
  private nearby = new NearbyLines();

  push(chunk: Buffer | string): void {
    const lines = (this.rest + chunk.toString()).split('\n');
    this.rest = lines.pop() ?? '';
    for (const line of lines) this.read(line);
  }

  problem(): EnvironmentProblem | null {
    if (this.rest) {
      this.read(this.rest);
      this.rest = '';
    }
    return this.nearby.problem();
  }

  private read(raw: string): void {
    this.nearby.read(stripVTControlCharacters(raw).replace(/\r$/, ''));
  }
}
