import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECOMMENDED_RULES, recommendedRulesText } from './recommended.ts';
import { NO_SPARK_RULES } from './resolve.ts';
import { RulesFileError } from './rules-file.ts';
import {
  changeSparkRules,
  loadSparkRules,
  MANAGED_RULES_FILE,
  sparkRulesFiles,
  type SparkRulesFiles,
} from './rules-store.ts';

let dir: string;
let files: SparkRulesFiles;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-store-'));
  files = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
});

afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const userText = () => readFile(files.user, 'utf8');

describe('where the files live', () => {
  it('puts the user file in the channel folder of the data folder', () => {
    const env = { SPARK_DATA_DIR: '/data', BRANCH_PREFIX: 'spark-dev' };
    expect(sparkRulesFiles(env)).toEqual({
      user: '/data/spark-dev/settings.json',
      managed: MANAGED_RULES_FILE,
    });
  });

  it('takes absolute overrides for both files', () => {
    const env = { SPARK_RULES_FILE: '/t/u.json', SPARK_MANAGED_RULES_FILE: '/t/m.json' };
    expect(sparkRulesFiles(env)).toEqual({ user: '/t/u.json', managed: '/t/m.json' });
  });
});

describe('the default', () => {
  it('is no rules when neither file exists, and loading writes nothing', async () => {
    const loaded = await loadSparkRules(files);
    expect(loaded.rules).toEqual(NO_SPARK_RULES);
    expect(loaded.problems).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('is no rules for an empty object or empty permissions', async () => {
    await mkdir(join(dir, 'spark'));
    for (const text of ['{}', '{ "permissions": {} }']) {
      await writeFile(files.user, text);
      expect((await loadSparkRules(files)).rules).toEqual(NO_SPARK_RULES);
    }
  });

  it('keeps a file the user wrote with the recommended rules as written', async () => {
    await mkdir(join(dir, 'spark'));
    await writeFile(files.user, recommendedRulesText());
    expect((await loadSparkRules(files)).rules).toEqual(RECOMMENDED_RULES);
  });
});

describe('a broken file', () => {
  it('fails safe to the recommended rules and reports it', async () => {
    await mkdir(join(dir, 'spark'));
    await writeFile(files.user, '{ "permissions": { "deny": "Push" } }');
    const loaded = await loadSparkRules(files);
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.problems).toEqual([
      {
        file: 'user',
        message: '"permissions.deny" is not a list, so Spark uses its recommended rules',
      },
    ]);
  });

  it('fails safe for a broken company file too', async () => {
    await writeFile(files.managed, 'nope');
    const loaded = await loadSparkRules(files);
    expect(loaded.rules.managed).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.problems[0]).toMatchObject({ file: 'managed' });
  });

  it('fails safe when the company folder cannot be searched, rather than reading no rules', async () => {
    const company = join(dir, 'company');
    await mkdir(company);
    await writeFile(join(company, 'managed.json'), '{}');
    await chmod(company, 0o000);
    const loaded = await loadSparkRules({ ...files, managed: join(company, 'managed.json') });
    await chmod(company, 0o700);
    expect(loaded.rules.managed).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.problems[0]).toMatchObject({ file: 'managed' });
  });

  it('is never overwritten by a change', async () => {
    await mkdir(join(dir, 'spark'));
    await writeFile(files.user, '{ broken');
    await expect(changeSparkRules(files, () => ({}))).rejects.toThrow(RulesFileError);
    expect(await userText()).toBe('{ broken');
  });
});

describe('changes', () => {
  it('create the file on the first change, with only that rule', async () => {
    const loaded = await changeSparkRules(files, () => ({
      add: [['allow', 'Gh(release create)']],
    }));
    expect(loaded.rules.user).toEqual({ allow: ['Gh(release create)'], ask: [], deny: [] });
  });

  it('keep what Spark does not use', async () => {
    await mkdir(join(dir, 'spark'));
    await writeFile(files.user, JSON.stringify({ permissions: {}, note: 'mine' }));
    const loaded = await changeSparkRules(files, () => ({
      add: [['allow', 'Gh(release create)']],
    }));
    expect(loaded.rules.user.allow).toContain('Gh(release create)');
    expect(JSON.parse(await userText()).note).toBe('mine');
    expect(loaded.problems).toEqual([
      { file: 'user', message: `"note" is kept but Spark doesn't use it` },
    ]);
  });

  it('run one at a time so no change is lost', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((verb) =>
        changeSparkRules(files, () => ({ add: [['allow', `Gh(release ${verb}x)`]] })),
      ),
    );
    const allowed = (await loadSparkRules(files)).rules.user.allow;
    expect(allowed).toEqual(expect.arrayContaining(['Gh(release ax)', 'Gh(release dx)']));
    expect(allowed).toHaveLength(4);
  });
});
