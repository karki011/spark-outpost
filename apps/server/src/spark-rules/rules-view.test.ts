import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { recommendedRulesText } from './recommended.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeSparkRules, loadSparkRules, type SparkRulesFiles } from './rules-store.ts';
import {
  choiceChange,
  ghAllowedChange,
  recommendedChange,
  rowLocked,
  sparkRulesView,
} from './rules-view.ts';

interface RulesJson {
  theme?: string;
  permissions: Record<string, unknown[]>;
}

let dir: string;
let files: SparkRulesFiles;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-view-'));
  files = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
  await mkdir(dirname(files.user), { recursive: true });
  await writeFile(files.user, recommendedRulesText());
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const view = async () => sparkRulesView(await loadSparkRules(files));
const row = async (id: string) => (await view()).rows.find((entry) => entry.row === id);
const fileJson = async () => JSON.parse(await readFile(files.user, 'utf8')) as RulesJson;
const writeUser = (value: unknown) => writeFile(files.user, JSON.stringify(value, null, 2));

describe('the Spark rules page view', () => {
  it('shows the recommended rules as set by your file', async () => {
    expect(await row('Push(force)')).toEqual({
      row: 'Push(force)',
      ids: ['Push(force)'],
      choice: 'ask',
      source: 'user',
    });
    expect(await row('workflows')).toMatchObject({
      ids: ['Gh(workflow run)', 'Gh(run rerun)', 'Gh(run cancel)'],
      choice: 'allow',
    });
    expect(await row('Gh(*)')).toMatchObject({ choice: 'deny', source: 'user' });
  });

  it("leaves a rule no file names to the agent's mode", async () => {
    await writeUser({ permissions: { allow: [], ask: [], deny: [] } });
    expect(await row('Push')).toMatchObject({ choice: 'mode', source: null });
  });

  it('shows a row whose rules disagree as mixed', async () => {
    await writeUser({ permissions: { allow: ['Gh(workflow run)'], deny: ['Gh(run rerun)'] } });
    expect(await row('workflows')).toMatchObject({ choice: null, source: 'user' });
  });

  it('locks a row the company file names and shows the winning rule', async () => {
    await writeFile(files.managed, JSON.stringify({ permissions: { deny: ['WriteOutside'] } }));
    const loaded = await loadSparkRules(files);
    expect(rowLocked(loaded.rules, 'WriteOutside')).toBe(true);
    expect(rowLocked(loaded.rules, 'Push')).toBe(false);
    expect(await row('WriteOutside')).toMatchObject({ choice: 'deny', source: 'managed' });
  });

  it('marks an allowed gh command the company refuses', async () => {
    await writeFile(files.managed, JSON.stringify({ permissions: { deny: ['Gh(*)'] } }));
    await changeSparkRules(files, () => ghAllowedChange('gh release create', true));
    expect((await view()).ghAllowed).toEqual([{ prefix: 'gh release create', overridden: true }]);
  });

  it('lists entries Spark does not use, by kind', async () => {
    await writeUser({
      theme: 'dark',
      permissions: { allow: ['Bash(npm test)', 'WebFetch'], deny: ['Push(others)', 7], extra: 1 },
    });
    expect((await view()).unused).toEqual([
      { entry: '"theme": "dark"', kind: 'key' },
      { entry: '"Bash(npm test)"', kind: 'agent-tool' },
      { entry: '"WebFetch"', kind: 'agent-tool' },
      { entry: '"Push(others)"', kind: 'rule' },
      { entry: '7', kind: 'rule' },
      { entry: '"permissions.extra": 1', kind: 'key' },
    ]);
  });

  it('reports a broken file and the recommended rules in force', async () => {
    await writeFile(files.user, '{ nope');
    const shown = await view();
    expect(shown.malformed).toBe(true);
    expect(shown.problems[0]?.message).toContain('recommended rules');
    expect(shown.rows.find((entry) => entry.row === 'Push')?.choice).toBe('deny');
  });
});

describe('changes the page writes', () => {
  it('moves a rule to one list, or out of every list for the agent’s mode', async () => {
    await changeSparkRules(files, () => choiceChange('Push(force)', 'deny'));
    let permissions = (await fileJson()).permissions;
    expect(permissions.deny).toContain('Push(force)');
    expect(permissions.ask).not.toContain('Push(force)');
    await changeSparkRules(files, () => choiceChange('workflows', 'mode'));
    permissions = (await fileJson()).permissions;
    expect(JSON.stringify(permissions)).not.toMatch(/workflow run|run rerun|run cancel/);
  });

  it('removes only the allow entry for a gh command', async () => {
    await changeSparkRules(files, () => ghAllowedChange('gh release create', true));
    await changeSparkRules(files, () => ghAllowedChange('gh release create', false));
    expect((await fileJson()).permissions.allow).not.toContain('Gh(release create)');
  });

  it('puts the recommended rules back and keeps everything else', async () => {
    await writeUser({
      theme: 'dark',
      permissions: { allow: ['Push(force)', 'Gh(release create)', 'Bash(ls)'], ask: [], deny: [] },
    });
    await changeSparkRules(files, () => recommendedChange());
    const file = await fileJson();
    expect(file.theme).toBe('dark');
    expect(file.permissions.allow).toEqual(
      expect.arrayContaining(['Gh(release create)', 'Bash(ls)', 'Gh(workflow run)']),
    );
    expect(file.permissions.allow).not.toContain('Push(force)');
    expect(file.permissions.ask).toContain('Push(force)');
    expect(file.permissions.deny).toEqual(expect.arrayContaining(['Push', 'Gh(*)']));
  });
});
