import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { dbFullRunReasons, selectBrowserSpecs, type SelectionReason } from './test-selection.ts';

const DEFAULT_BASE = 'main';

function git(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function changedFiles(base: string): string[] {
  return [
    ...new Set([
      ...git(['diff', '--name-only', `${base}...HEAD`]),
      ...git(['diff', '--name-only', 'HEAD']),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ]),
  ].toSorted();
}

function printReasons(reasons: SelectionReason[]): void {
  const byRule = new Map<string, string[]>();
  for (const reason of reasons) {
    const key = `${reason.rule} → ${reason.selects}`;
    byRule.set(key, [...(byRule.get(key) ?? []), reason.path]);
  }
  for (const [rule, paths] of byRule) {
    console.log(rule);
    for (const file of paths) console.log(`  ${file}`);
  }
}

function run(args: string[], dryRun: boolean): number {
  console.log(`\n${dryRun ? 'Would run' : 'Running'}: pnpm exec ${args.join(' ')}`);
  if (dryRun) return 0;
  return spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit' }).status ?? 1;
}

function runDb(changed: string[], base: string, dryRun: boolean): number {
  const reasons = dbFullRunReasons(changed);
  if (reasons.length === 0) {
    console.log(`No full-run trigger: db tests that import a file changed since ${base}.`);
    return run(['vitest', 'run', '--project', 'db', '--changed', base], dryRun);
  }
  printReasons(reasons);
  return run(['vitest', 'run', '--project', 'db'], dryRun);
}

function specsImportingChanges(mergeBase: string): string[] {
  const listed = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--list', '--reporter=json', `--only-changed=${mergeBase}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = JSON.parse(listed.stdout) as { suites?: { file: string }[] };
  return (report.suites ?? []).map((suite) => `tests/browser/${path.basename(suite.file)}`);
}

function runBrowser(changed: string[], base: string, dryRun: boolean): number {
  const mergeBase = git(['merge-base', base, 'HEAD'])[0]!;
  if (dryRun) {
    console.log(
      `Dry run: specs that import a changed helper are not listed (playwright test --list --only-changed=${mergeBase}).`,
    );
  }
  const selection = selectBrowserSpecs(changed, dryRun ? [] : specsImportingChanges(mergeBase));
  printReasons(selection.reasons);
  const specs = selection.specs.filter((spec) => existsSync(spec));
  if (specs.length === 0) {
    console.log('\nNo browser specs are affected.');
    return 0;
  }
  console.log(`\n${selection.all ? 'All' : 'Selected'} ${specs.length} specs:`);
  for (const spec of specs) console.log(`  ${spec}`);
  return run(['playwright', 'test', ...specs], dryRun);
}

function main(): number {
  const [mode, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes('--dry-run');
  const base =
    flags.find((flag) => flag.startsWith('--base='))?.slice('--base='.length) ?? DEFAULT_BASE;
  if (mode !== 'db' && mode !== 'browser') {
    console.error('Usage: tsx scripts/test-changed.ts <db|browser> [--base=main] [--dry-run]');
    return 2;
  }
  const changed = changedFiles(base);
  if (changed.length === 0) {
    console.log(`Nothing changed since ${base}.`);
    return 0;
  }
  console.log(`${changed.length} file(s) changed since ${base}.\n`);
  return mode === 'db' ? runDb(changed, base, dryRun) : runBrowser(changed, base, dryRun);
}

process.exit(main());
