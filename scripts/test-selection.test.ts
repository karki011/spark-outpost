import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PATH_RULES,
  PERF_SPECS,
  RUN_ALL_PREFIXES,
  SHELL_SPECS,
  SHOTS_SPECS,
  SPEC_GROUPS,
  specFile,
} from '../tests/browser/spec-map.ts';
import {
  connectionShortfall,
  CONNECTIONS_PER_STACK,
  dbFullRunReasons,
  planShards,
  selectBrowserSpecs,
} from './test-selection.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const onDisk = readdirSync(path.join(ROOT, 'tests/browser'))
  .filter((name) => name.endsWith('.spec.ts'))
  .map((name) => name.replace(/\.spec\.ts$/, ''))
  .toSorted();
const grouped = Object.values(SPEC_GROUPS).flat();
const mapped = [...SHELL_SPECS, ...grouped];
const shell = SHELL_SPECS.map(specFile);

describe('browser spec map', () => {
  it('lists every spec on disk exactly once', () => {
    const listed = [...mapped, ...PERF_SPECS, ...SHOTS_SPECS];
    expect(listed.toSorted()).toEqual(onDisk);
  });

  it('keeps every perf spec in the perf list and nowhere else', () => {
    expect([...PERF_SPECS].toSorted()).toEqual(onDisk.filter((name) => name.endsWith('-perf')));
  });

  it('points every rule at a folder that exists', () => {
    const folders = [...PATH_RULES.map((rule) => rule.prefix), ...RUN_ALL_PREFIXES].filter(
      (prefix) => prefix.endsWith('/'),
    );
    const missing = folders.filter((folder) => {
      try {
        readdirSync(path.join(ROOT, folder));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it('has a rule or a run-everything entry for every source folder', () => {
    const uncovered = ['apps/web/src', 'apps/server/src'].flatMap((parent) =>
      readdirSync(path.join(ROOT, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
        .map((entry) => `${parent}/${entry.name}/`)
        .filter(
          (folder) =>
            !PATH_RULES.some((rule) => rule.prefix === folder) &&
            !RUN_ALL_PREFIXES.some((prefix) => prefix === folder),
        ),
    );
    expect(uncovered).toEqual([]);
  });
});

describe('selectBrowserSpecs', () => {
  it('selects a feature group and the shell for a feature folder', () => {
    const selection = selectBrowserSpecs(['apps/web/src/phone/PhonePage.tsx']);
    expect(selection.all).toBe(false);
    expect(selection.specs).toEqual([...SPEC_GROUPS.phone.map(specFile), ...shell].toSorted());
    expect(selection.reasons).toEqual([
      {
        path: 'apps/web/src/phone/PhonePage.tsx',
        rule: 'apps/web/src/phone/',
        selects: 'phone (4)',
      },
    ]);
  });

  it('adds the groups of every rule a path matches', () => {
    const selection = selectBrowserSpecs(['apps/web/src/chat/tickets/TicketChip.tsx']);
    expect(selection.specs).toContain('tests/browser/tickets-flow.spec.ts');
    expect(selection.specs).toContain('tests/browser/chat-send.spec.ts');
    expect(selection.specs).not.toContain('tests/browser/phone.spec.ts');
  });

  it('runs everything when a shared path changes', () => {
    for (const file of [
      'packages/contracts/src/remote.ts',
      'apps/web/public/theme.css',
      'apps/web/src/ui/Button.tsx',
      'apps/server/src/persistence/db.ts',
      'apps/server/migrations/0001_init.sql',
      'apps/server/test/fake-acp-agent.ts',
      'tests/browser/provider-stub.ts',
      'playwright.config.ts',
      'package.json',
      'apps/web/package.json',
      'pnpm-lock.yaml',
      'tsconfig.base.json',
    ]) {
      const selection = selectBrowserSpecs([file]);
      expect(selection.all, file).toBe(true);
      expect(selection.specs).toHaveLength(mapped.length);
    }
  });

  it('runs everything when an app path matches no rule', () => {
    for (const file of [
      'apps/web/src/main.tsx',
      'apps/web/src/new-feature/Thing.tsx',
      'apps/server/src/config.ts',
      'packages/new-package/src/index.ts',
      'tests/fixtures/other/serve.ts',
    ]) {
      const selection = selectBrowserSpecs([file]);
      expect(selection.all, file).toBe(true);
      expect(selection.reasons[0]?.rule).toBe('no rule for this path (fail safe)');
    }
  });

  it('never selects perf or screenshot specs, even when everything runs', () => {
    const excluded = [...PERF_SPECS, ...SHOTS_SPECS].map(specFile);
    const everything = selectBrowserSpecs(['package.json']).specs;
    const changedPerf = selectBrowserSpecs(excluded, excluded);
    expect(everything.filter((spec) => excluded.includes(spec))).toEqual([]);
    expect(changedPerf.specs).toEqual([]);
    expect(changedPerf.reasons[0]?.rule).toContain('pnpm test:browser:perf');
  });

  it('includes a changed spec and specs that import a changed helper', () => {
    const selection = selectBrowserSpecs(
      ['tests/browser/zai.spec.ts', 'tests/browser/sidebar-seed.ts'],
      ['tests/browser/zai.spec.ts', 'tests/browser/sidebar.spec.ts'],
    );
    expect(selection.specs).toEqual(
      ['tests/browser/sidebar.spec.ts', 'tests/browser/zai.spec.ts', ...shell].toSorted(),
    );
    expect(selection.reasons.map((reason) => reason.rule)).toEqual([
      'changed spec',
      'test helper: specs that import it',
      'imports a changed file',
    ]);
  });

  it('selects nothing for unit tests, docs and files outside the app', () => {
    const selection = selectBrowserSpecs([
      'apps/web/src/phone/phone-model.test.ts',
      'apps/server/test/remote-policy.db.test.ts',
      'apps/server/test/remote-support.ts',
      'docs/architecture/PHONE_REMOTE.md',
      'scripts/test-changed.ts',
      'AGENTS.md',
    ]);
    expect(selection).toMatchObject({ all: false, specs: [] });
    expect(selection.reasons).toHaveLength(6);
  });

  it('maps the user guide to the docs specs', () => {
    expect(selectBrowserSpecs(['docs/guide/settings.md']).specs).toEqual(
      [...SPEC_GROUPS['docs-help'].map(specFile), ...shell].toSorted(),
    );
  });
});

describe('dbFullRunReasons', () => {
  it('asks for the whole db project when a file the suite reads by path changes', () => {
    for (const file of [
      'apps/server/migrations/0200_new.sql',
      'apps/server/test/worker-database.ts',
      'apps/server/test/support.ts',
      'apps/server/test/fake-acp-plans.ts',
      'apps/server/test/echo-mcp-server.mjs',
      'apps/server/src/codescan/parse-worker.ts',
      'tests/browser/bin/gh-fake.ts',
      'docs/guide/sparks.md',
      'pnpm-lock.yaml',
      'package.json',
      'apps/server/tsconfig.json',
      'vitest.config.ts',
    ]) {
      expect(dbFullRunReasons([file]), file).toHaveLength(1);
    }
  });

  it('leaves ordinary source and test files to the import graph', () => {
    expect(
      dbFullRunReasons([
        'apps/server/src/tickets/sync.ts',
        'apps/server/test/tickets.db.test.ts',
        'apps/server/test/ticket-support.ts',
        'apps/web/src/phone/PhonePage.tsx',
      ]),
    ).toEqual([]);
  });
});

describe('planShards', () => {
  const url = 'postgres://user:secret@127.0.0.1:5433/spark_outpost_test';

  it('gives each shard its own slot, ports and database', () => {
    expect(planShards(3, 50, url)).toEqual([
      {
        shard: '1/3',
        slot: 50,
        ports: { stub: 20500, api: 20501, web: 20502 },
        database: 'spark_outpost_test_slot50',
      },
      {
        shard: '2/3',
        slot: 51,
        ports: { stub: 20510, api: 20511, web: 20512 },
        database: 'spark_outpost_test_slot51',
      },
      {
        shard: '3/3',
        slot: 52,
        ports: { stub: 20520, api: 20521, web: 20522 },
        database: 'spark_outpost_test_slot52',
      },
    ]);
  });

  it('refuses a database url the slots would share', () => {
    expect(() => planShards(2, 1, 'postgres://127.0.0.1/spark_outpost_test_other')).toThrow(
      /must name spark_outpost_test/,
    );
  });

  it('refuses a bad shard count or slot', () => {
    expect(() => planShards(0, 1, url)).toThrow(/Shard count/);
    expect(() => planShards(2, 400, url)).toThrow(/Slots/);
  });
});

describe('connectionShortfall', () => {
  it('counts the connections missing for the stacks', () => {
    expect(connectionShortfall(3, 100, 12)).toBe(0);
    expect(connectionShortfall(4, 100, 12)).toBe(4 * CONNECTIONS_PER_STACK + 12 - 100);
  });
});
