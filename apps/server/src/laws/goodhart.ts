import { LAW_SCOPE_ITEMS } from '../advisor/policy.ts';
import { namedFiles } from '../orchestration/context.ts';
import { TEST_FILE } from '../orchestration/critic-rule.ts';
import { code, type LawFacts, type LawFinding } from './finding.ts';
import { dirName, mentions, parsePatch, SNAPSHOT_FILE, type PatchFile } from './patch.ts';

const SKIP_ADDED =
  /\b(?:(?:it|test|describe)\.(?:skip|only|todo)|xit|xdescribe|xtest|fit|fdescribe)\s*\(|@pytest\.mark\.(?:skip|xfail)|\bt\.Skip(?:Now|f)?\(|#\[ignore\]|\.skip\(\s*\)/;
const ASSERTION = /\b(?:expect|assert\w*)\s*\(|\bassert\s|\bt\.(?:Error|Fatal)f?\(|\bshould\./g;
const STRICT_MATCHER =
  /\.(?:toBe|toEqual|toStrictEqual|toHaveBeenCalledWith|toHaveBeenNthCalledWith|toMatchObject|toContain|toHaveLength|toThrow)\(\s*[^)\s]/g;
const LOOSE_MATCHER =
  /\.(?:toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toHaveBeenCalled|toThrow)\(\s*\)|\.not\.toBeNull\(\s*\)|expect\.anything\(\)|expect\.any\(/g;

const CONFIG_FILES: readonly [RegExp, string][] = [
  [
    /(?:^|\/)(?:\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|\.prettierrc[^/]*|prettier\.config\.[cm]?js|biome\.jsonc?|\.golangci\.ya?ml|ruff\.toml|\.flake8|\.rubocop\.yml)$/,
    'lint',
  ],
  [/(?:^|\/)(?:tsconfig[^/]*\.json|jsconfig\.json|mypy\.ini)$/, 'typecheck'],
  [
    /(?:^|\/)(?:\.github\/workflows\/[^/]+|\.gitlab-ci\.yml|\.circleci\/[^/]+|azure-pipelines\.yml|\.husky\/[^/]+|lefthook\.ya?ml)$/,
    'CI',
  ],
  [
    /(?:^|\/)(?:vitest|jest|playwright|karma|cypress)\.config\.[cm]?[jt]s$|(?:^|\/)(?:pytest\.ini|conftest\.py)$/,
    'test runner',
  ],
  [/(?:^|\/)(?:knip\.jsonc?|\.c8rc[^/]*|\.nycrc[^/]*)$/, 'check'],
];

const CHECK_SCRIPT = /^\s*"((?:test|lint|typecheck|check|format|build|ci)[\w:.-]*)"\s*:/;

const ASKS_ABOUT = {
  tests:
    /\b(?:skip|disable|remove|delete|loosen|relax)\w*\b[^.\n]{0,40}\btests?\b|\btests?\b[^.\n]{0,40}\b(?:skip|disable|remove|delete)\w*/i,
  snapshot: /\bsnapshots?\b/i,
  config:
    /\b(?:lint\w*|eslint|prettier|biome|tsconfig|typescript config|type ?check\w*|ci|workflows?|pipeline|github actions|vitest|jest|playwright|pytest|config\w*|scripts?)\b/i,
};

function count(lines: readonly string[], pattern: RegExp): number {
  return lines.reduce((total, line) => total + (line.match(pattern)?.length ?? 0), 0);
}

function weakenedTest(file: PatchFile): LawFinding | null {
  const reasons: string[] = [];
  const skips = file.added.filter((line) => SKIP_ADDED.test(line)).length;
  const skipsBefore = file.removed.filter((line) => SKIP_ADDED.test(line)).length;
  if (skips > skipsBefore) reasons.push('adds skip or only');
  const lost = count(file.removed, ASSERTION) - count(file.added, ASSERTION);
  if (lost > 0) reasons.push(`${lost} fewer assertion${lost === 1 ? '' : 's'}`);
  const strictLost = count(file.removed, STRICT_MATCHER) - count(file.added, STRICT_MATCHER);
  const looseGained = count(file.added, LOOSE_MATCHER) - count(file.removed, LOOSE_MATCHER);
  if (strictLost > 0 && looseGained > 0) reasons.push('loosens matchers');
  if (reasons.length === 0) return null;
  return {
    law: 'goodhart',
    kind: 'weakened_test',
    path: file.path,
    text: `Weakened ${code(file.path)}: ${reasons.join(', ')} — why?`,
  };
}

function configArea(path: string): string | null {
  return CONFIG_FILES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

function scriptChanges(file: PatchFile): string[] {
  if (!/(?:^|\/)package\.json$/.test(file.path)) return [];
  const names = new Set<string>();
  for (const line of [...file.added, ...file.removed]) {
    const name = CHECK_SCRIPT.exec(line)?.[1];
    if (name) names.add(name);
  }
  return [...names];
}

function configFinding(file: PatchFile, request: string): LawFinding | null {
  if (ASKS_ABOUT.config.test(request)) return null;
  const area = configArea(file.path);
  if (area) {
    return {
      law: 'goodhart',
      kind: 'config',
      path: file.path,
      text: `Changed ${area} config ${code(file.path)}, which the task didn't ask for — why?`,
    };
  }
  const scripts = scriptChanges(file);
  if (scripts.length === 0) return null;
  return {
    law: 'goodhart',
    kind: 'config',
    path: file.path,
    text: `Changed the ${scripts.map(code).join(', ')} script in ${code(file.path)}, which the task didn't ask for — why?`,
  };
}

function snapshotFinding(file: PatchFile, request: string): LawFinding | null {
  if (!SNAPSHOT_FILE.test(file.path) || ASKS_ABOUT.snapshot.test(request)) return null;
  return {
    law: 'goodhart',
    kind: 'snapshot',
    path: file.path,
    text: `Updated snapshot ${code(file.path)} — check it matches the intended behaviour.`,
  };
}

function inScope(path: string, named: readonly string[], text: string): boolean {
  if (text.includes(path) || mentions(text, path.split('/').at(-1) ?? path)) return true;
  const folder = dirName(path);
  return named.some((name) => path.endsWith(name) || dirName(name) === folder);
}

const NOT_SCOPED =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock)$/;

function scopeFindings(files: readonly PatchFile[], facts: LawFacts): LawFinding[] {
  const named = namedFiles([facts.request, ...facts.plan]);
  if (named.length === 0) return [];
  const text = [facts.request, ...facts.plan, ...facts.replies].join('\n');
  return files
    .filter((file) => !NOT_SCOPED.test(file.path) && !inScope(file.path, named, text))
    .slice(0, LAW_SCOPE_ITEMS)
    .map((file) => ({
      law: 'goodhart' as const,
      kind: 'scope' as const,
      path: file.path,
      text: `Changed ${code(file.path)}, which the request and plan didn't name — check it.`,
    }));
}

export function guardFindings(patch: string, facts: LawFacts): LawFinding[] {
  const files = parsePatch(patch);
  const perFile = files.flatMap((file) => {
    const found: (LawFinding | null)[] = [
      snapshotFinding(file, facts.request),
      configFinding(file, facts.request),
    ];
    if (TEST_FILE.test(file.path) && !file.deleted && !ASKS_ABOUT.tests.test(facts.request)) {
      found.push(weakenedTest(file));
    }
    return found.filter((finding): finding is LawFinding => finding !== null);
  });
  const flagged = new Set(perFile.map((finding) => finding.path));
  const scoped = scopeFindings(
    files.filter((file) => !flagged.has(file.path)),
    facts,
  );
  return [...perFile, ...scoped];
}
