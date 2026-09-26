import { CHECK_COMMANDS_MAX, type CheckKind } from '@spark-outpost/contracts';
import { hasControlOperators, splitSimpleCommands } from '../approvals/commands.ts';

export interface CheckCommand {
  kind: CheckKind;
  command: string;
  argv: string[];
}

export interface ProjectFiles {
  packageJson: string | null;
  present: ReadonlySet<string>;
  pyproject: string | null;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx']);

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

const SCRIPT_NAMES: readonly (readonly [CheckKind, readonly string[]])[] = [
  ['typecheck', ['typecheck', 'type-check', 'check-types', 'tsc']],
  ['lint', ['lint']],
  ['test', ['test']],
];

const PLACEHOLDER_TEST = /no test specified/i;
const WATCHES = /(?:^|\s)(?:--watch\b|-w\b|watch\b)/;

export const CONFIG_FILES = [
  'package.json',
  'pyproject.toml',
  'pytest.ini',
  'Cargo.toml',
  'go.mod',
  ...LOCKFILES.map(([file]) => file),
];

export function packageManager(present: ReadonlySet<string>): PackageManager {
  return LOCKFILES.find(([file]) => present.has(file))?.[1] ?? 'npm';
}

export function packageScripts(packageJson: string | null): Record<string, string> {
  if (!packageJson) return {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: unknown };
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
    return Object.fromEntries(
      Object.entries(scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function usable(kind: CheckKind, script: string): boolean {
  if (WATCHES.test(script)) return false;
  return !(kind === 'test' && PLACEHOLDER_TEST.test(script));
}

function scriptCommand(manager: PackageManager, kind: CheckKind, name: string): CheckCommand {
  const argv = manager === 'npm' && name === 'test' ? ['npm', 'test'] : [manager, 'run', name];
  return { kind, command: argv.join(' '), argv };
}

function scriptChecks(files: ProjectFiles): CheckCommand[] {
  const scripts = packageScripts(files.packageJson);
  const manager = packageManager(files.present);
  return SCRIPT_NAMES.flatMap(([kind, names]) => {
    const name = names.find((candidate) => scripts[candidate] !== undefined);
    return name && usable(kind, scripts[name]!) ? [scriptCommand(manager, kind, name)] : [];
  });
}

function usesPytest(files: ProjectFiles): boolean {
  return files.present.has('pytest.ini') || /\[tool\.pytest/.test(files.pyproject ?? '');
}

function toolChecks(files: ProjectFiles): CheckCommand[] {
  const found: CheckCommand[] = [];
  const add = (argv: string[]) => found.push({ kind: 'test', command: argv.join(' '), argv });
  if (files.present.has('Cargo.toml')) add(['cargo', 'test', '--quiet']);
  if (files.present.has('go.mod')) add(['go', 'test', './...']);
  if (usesPytest(files)) add(['python3', '-m', 'pytest', '-q']);
  return found;
}

export function detectChecks(files: ProjectFiles): CheckCommand[] {
  const scripts = scriptChecks(files);
  return (scripts.length > 0 ? scripts : toolChecks(files)).slice(0, CHECK_COMMANDS_MAX);
}

export function kindOf(argv: readonly string[]): CheckKind {
  const words = argv.join(' ');
  if (/\b(?:tsc|typecheck|type-check|check-types|mypy)\b/.test(words)) return 'typecheck';
  if (/\b(?:lint|eslint|ruff|clippy)\b/.test(words)) return 'lint';
  if (/\btest\b|pytest|vitest|jest/.test(words)) return 'test';
  return 'custom';
}

export function configuredChecks(commands: readonly string[]): CheckCommand[] {
  return commands.slice(0, CHECK_COMMANDS_MAX).flatMap((command) => {
    if (hasControlOperators(command)) return [];
    const parsed = splitSimpleCommands(command);
    const argv = parsed.length === 1 ? parsed[0]! : null;
    if (!argv || argv.length === 0) return [];
    return [{ kind: kindOf(argv), command: command.trim(), argv }];
  });
}
