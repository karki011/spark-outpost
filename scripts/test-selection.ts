import path from 'node:path';
import {
  IMPORT_TRACKED_PREFIXES,
  PATH_RULES,
  PERF_SPECS,
  RUN_ALL_PREFIXES,
  SHELL_SPECS,
  SHOTS_SPECS,
  SPEC_GROUPS,
  specFile,
  type SpecGroup,
} from '../tests/browser/spec-map.ts';
import { slotDatabaseUrl, slotPorts } from '../tests/browser/stub-config.ts';

export interface SelectionReason {
  path: string;
  rule: string;
  selects: string;
}

export interface BrowserSelection {
  all: boolean;
  specs: string[];
  reasons: SelectionReason[];
}

const DB_FULL_RUN_PREFIXES: readonly { prefix: string; why: string }[] = [
  { prefix: 'apps/server/migrations/', why: 'migrations are read from disk' },
  { prefix: 'apps/server/test/worker-database.ts', why: 'db setup file' },
  { prefix: 'apps/server/test/support.ts', why: 'db setup file imports it' },
  { prefix: 'apps/server/test/fake-', why: 'the fake agent is started by path' },
  { prefix: 'apps/server/test/echo-mcp-server.mjs', why: 'started by path' },
  { prefix: 'apps/server/src/codescan/parse-worker.ts', why: 'worker thread loaded by path' },
  { prefix: 'apps/server/src/codemode/worker.ts', why: 'worker thread loaded by path' },
  { prefix: 'tests/browser/bin/', why: 'fake gh and codex are started by path' },
  { prefix: 'docs/guide/', why: 'spark_docs reads the guide from disk' },
  { prefix: 'patches/', why: 'dependency patch' },
  { prefix: 'pnpm-lock.yaml', why: 'dependencies' },
  { prefix: 'pnpm-workspace.yaml', why: 'dependencies' },
  { prefix: 'vitest.config.ts', why: 'test config' },
];

const UNIT_TEST_FILE = /\.test\.tsx?$/;
const SPEC_FILE = /^tests\/browser\/([^/]+)\.spec\.ts$/;
const WATCHED_ROOTS = ['apps/', 'packages/', 'tests/'];
const ALL_SPECS = [...SHELL_SPECS, ...Object.values(SPEC_GROUPS).flat()].map(specFile);
const NOT_IN_INCREMENTAL_RUNS = new Map<string, string>([
  ...PERF_SPECS.map((name): [string, string] => [name, 'perf spec: run pnpm test:browser:perf']),
  ...SHOTS_SPECS.map((name): [string, string] => [
    name,
    'screenshot spec: run pnpm docs:screenshots',
  ]),
]);

function isPackageConfig(file: string): boolean {
  const name = path.posix.basename(file);
  return name === 'package.json' || /^tsconfig.*\.json$/.test(name);
}

export function dbFullRunReasons(changed: readonly string[]): SelectionReason[] {
  const reasons: SelectionReason[] = [];
  for (const file of changed) {
    const trigger = DB_FULL_RUN_PREFIXES.find(({ prefix }) => file.startsWith(prefix));
    if (trigger) reasons.push({ path: file, rule: trigger.why, selects: 'all db tests' });
    else if (isPackageConfig(file))
      reasons.push({ path: file, rule: 'package or TypeScript config', selects: 'all db tests' });
  }
  return reasons;
}

function runAllRule(file: string): string | null {
  if (isPackageConfig(file)) return 'package or TypeScript config';
  const shared = RUN_ALL_PREFIXES.find((prefix) => file.startsWith(prefix));
  return shared ? `shared path ${shared}` : null;
}

function classify(file: string): { rule: string; all?: true; groups?: SpecGroup[]; spec?: string } {
  const spec = SPEC_FILE.exec(file)?.[1];
  if (spec) {
    const excluded = NOT_IN_INCREMENTAL_RUNS.get(spec);
    return excluded ? { rule: excluded } : { rule: 'changed spec', spec: specFile(spec) };
  }
  if (UNIT_TEST_FILE.test(file)) return { rule: 'unit or db test file' };
  const shared = runAllRule(file);
  if (shared) return { rule: shared, all: true };
  const rules = PATH_RULES.filter(({ prefix }) => file.startsWith(prefix));
  if (rules.length > 0) {
    return {
      rule: rules.map(({ prefix }) => prefix).join(' + '),
      groups: [...new Set(rules.flatMap(({ groups }) => groups))],
    };
  }
  if (IMPORT_TRACKED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    return { rule: 'test helper: specs that import it' };
  if (WATCHED_ROOTS.some((root) => file.startsWith(root)))
    return { rule: 'no rule for this path (fail safe)', all: true };
  return { rule: 'outside the app' };
}

export function selectBrowserSpecs(
  changed: readonly string[],
  importAffected: readonly string[] = [],
): BrowserSelection {
  const reasons: SelectionReason[] = [];
  const groups = new Set<SpecGroup>();
  const direct = new Set<string>();
  let all = false;
  for (const file of changed) {
    const hit = classify(file);
    if (hit.all) all = true;
    for (const group of hit.groups ?? []) groups.add(group);
    if (hit.spec) direct.add(hit.spec);
    const selects = hit.all
      ? 'all specs'
      : hit.groups
        ? hit.groups.map((group) => `${group} (${SPEC_GROUPS[group].length})`).join(', ')
        : (hit.spec ?? 'nothing');
    reasons.push({ path: file, rule: hit.rule, selects });
  }
  for (const spec of importAffected) {
    const name = SPEC_FILE.exec(spec)?.[1];
    if (!name || NOT_IN_INCREMENTAL_RUNS.has(name) || direct.has(spec)) continue;
    direct.add(spec);
    reasons.push({ path: spec, rule: 'imports a changed file', selects: spec });
  }
  if (all) return { all: true, specs: ALL_SPECS.toSorted(), reasons };
  const selected = new Set(direct);
  for (const group of groups) for (const name of SPEC_GROUPS[group]) selected.add(specFile(name));
  if (selected.size === 0) return { all: false, specs: [], reasons };
  for (const name of SHELL_SPECS) selected.add(specFile(name));
  return { all: false, specs: [...selected].toSorted(), reasons };
}

export interface ShardPlan {
  shard: string;
  slot: number;
  ports: { stub: number; api: number; web: number };
  database: string;
}

export function planShards(count: number, firstSlot: number, testDatabaseUrl: string): ShardPlan[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Shard count must be 1 or more.');
  if (!Number.isInteger(firstSlot) || firstSlot < 1 || firstSlot + count - 1 > 400)
    throw new Error('Slots must be between 1 and 400.');
  if (slotDatabaseUrl(testDatabaseUrl, firstSlot) === testDatabaseUrl)
    throw new Error(
      'TEST_DATABASE_URL must name spark_outpost_test so each shard gets its own spark_outpost_test_slotN database.',
    );
  return Array.from({ length: count }, (_, index) => {
    const slot = firstSlot + index;
    return {
      shard: `${index + 1}/${count}`,
      slot,
      ports: slotPorts(slot),
      database: new URL(slotDatabaseUrl(testDatabaseUrl, slot)).pathname.slice(1),
    };
  });
}

export const CONNECTIONS_PER_STACK = 24;

export function connectionShortfall(stacks: number, maxConnections: number, inUse: number): number {
  return Math.max(0, stacks * CONNECTIONS_PER_STACK + inUse - maxConnections);
}
