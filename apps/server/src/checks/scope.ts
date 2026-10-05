import type { CheckScope } from '@spark-outpost/contracts';
import { hasControlOperators, splitSimpleCommands } from '../approvals/commands.ts';
import {
  packageManager,
  packageScripts,
  type CheckCommand,
  type PackageManager,
  type ProjectFiles,
} from './detect.ts';

export const SCOPE_MAX_FILES = 50;
export const SCOPE_MAX_PACKAGES = 20;

export interface ChangeFacts {
  files: ProjectFiles;
  changed: readonly string[];
  existing: readonly string[];
  packageDirs: readonly string[] | null;
}

export interface ScopedCheck {
  check: CheckCommand;
  scope: CheckScope;
}

const RUNNERS: Record<PackageManager, readonly string[]> = {
  pnpm: ['pnpm', 'exec'],
  npm: ['npx', '--no-install'],
  yarn: ['yarn'],
  bun: ['bunx'],
};

function scriptName(check: CheckCommand): string | null {
  const [, verb, name] = check.argv;
  if (check.argv.length === 2 && verb === 'test') return 'test';
  return check.argv.length === 3 && verb === 'run' && name ? name : null;
}

function scriptTokens(check: CheckCommand, files: ProjectFiles): string[] | null {
  const name = scriptName(check);
  const body = name ? packageScripts(files.packageJson)[name] : undefined;
  if (!body || hasControlOperators(body)) return null;
  const parsed = splitSimpleCommands(body);
  return parsed.length === 1 && parsed[0]!.length > 0 ? parsed[0]! : null;
}

function flagsOnly(tokens: readonly string[]): boolean {
  return tokens.every((token) => token.startsWith('-'));
}

function hasFlag(tokens: readonly string[], names: readonly string[]): boolean {
  return tokens.some((token) =>
    names.some((name) => token === name || token.startsWith(`${name}=`)),
  );
}

function nxAffected(tokens: readonly string[], facts: ChangeFacts): string[] | null {
  if (!facts.files.present.has('nx.json') || tokens[1] !== 'run-many') return null;
  const rest = tokens.slice(2);
  if (hasFlag(rest, ['-p', '--projects', '--project', '--files', '--base'])) return null;
  const kept = rest.filter((token) => token !== '--all');
  if (!hasFlag(kept, ['-t', '--target', '--targets'])) return null;
  return ['nx', 'affected', ...kept, `--files=${facts.changed.join(',')}`];
}

function dirFilters(facts: ChangeFacts): string[] | null {
  const dirs = facts.packageDirs;
  if (!dirs || dirs.length === 0 || dirs.length > SCOPE_MAX_PACKAGES) return null;
  return dirs.map((dir) => `...{./${dir}}`);
}

function turboFiltered(tokens: readonly string[], facts: ChangeFacts): string[] | null {
  if (!facts.files.present.has('turbo.json')) return null;
  const filters = dirFilters(facts);
  if (!filters || hasFlag(tokens, ['--filter', '-F', '--affected'])) return null;
  return ['turbo', ...tokens.slice(1), ...filters.map((filter) => `--filter=${filter}`)];
}

function pnpmFiltered(tokens: readonly string[], facts: ChangeFacts): string[] | null {
  if (!facts.files.present.has('pnpm-workspace.yaml')) return null;
  const recursive = (token: string) => token === '-r' || token === '--recursive';
  const filters = dirFilters(facts);
  if (!filters || !tokens.some(recursive) || hasFlag(tokens, ['--filter', '-F'])) return null;
  const rest = tokens.slice(1).filter((token) => !recursive(token));
  return ['pnpm', ...filters.flatMap((filter) => ['--filter', filter]), ...rest];
}

function relatedTests(tokens: readonly string[], facts: ChangeFacts): string[] | null {
  if (facts.existing.length === 0) return null;
  const [tool, ...rest] = tokens;
  if (tool === 'vitest') {
    const flags = rest[0] === 'run' ? rest.slice(1) : rest;
    if (!flagsOnly(flags)) return null;
    return ['vitest', 'related', '--run', '--passWithNoTests', ...flags, ...facts.existing];
  }
  if (tool === 'jest' && flagsOnly(rest)) {
    return ['jest', ...rest, '--passWithNoTests', '--findRelatedTests', ...facts.existing];
  }
  return null;
}

function scopedTool(tokens: readonly string[], check: CheckCommand, facts: ChangeFacts) {
  const tool = tokens[0];
  if (tool === 'nx') return { argv: nxAffected(tokens, facts), label: 'affected projects' };
  if (tool === 'turbo') return { argv: turboFiltered(tokens, facts), label: 'affected packages' };
  if (tool === 'pnpm') {
    return { argv: pnpmFiltered(tokens, facts), direct: true, label: 'affected packages' };
  }
  if (check.kind === 'test') return { argv: relatedTests(tokens, facts), label: 'changed files' };
  return null;
}

export function scopedCheck(check: CheckCommand, facts: ChangeFacts): ScopedCheck | null {
  if (facts.changed.length === 0 || facts.changed.length > SCOPE_MAX_FILES) return null;
  const tokens = scriptTokens(check, facts.files);
  const scoped = tokens ? scopedTool(tokens, check, facts) : null;
  if (!scoped?.argv) return null;
  const manager = packageManager(facts.files.present, facts.files.packageJson);
  const argv = 'direct' in scoped ? scoped.argv : [...RUNNERS[manager], ...scoped.argv];
  return {
    check: { kind: check.kind, command: argv.join(' '), argv },
    scope: { whole: check.command, label: scoped.label },
  };
}

export function scopedSuggestion(check: CheckCommand, files: ProjectFiles): string | null {
  const manager = packageManager(files.present, files.packageJson);
  const run = RUNNERS[manager].join(' ');
  const task = check.kind === 'custom' ? 'test' : check.kind;
  if (files.present.has('nx.json')) return `${run} nx affected -t ${task}`;
  if (files.present.has('turbo.json')) return `${run} turbo run ${task} --affected`;
  if (files.present.has('pnpm-workspace.yaml'))
    return `pnpm --filter "...[origin/main]" run ${task}`;
  return null;
}
