import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SPARK_RULES } from '@spark-outpost/contracts';
import { RECOMMENDED_RULES, recommendedRulesText } from './recommended.ts';
import { RulesFileError } from './rules-file.ts';
import {
  changeSparkRules,
  loadSparkRules,
  MANAGED_RULES_FILE,
  seededMarker,
  seedSparkRules,
  sparkRulesFiles,
  type SparkRulesFiles,
} from './rules-store.ts';

let dir: string;
let files: SparkRulesFiles;
const gh = DEFAULT_SPARK_RULES;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-store-'));
  files = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const userText = () => readFile(files.user, 'utf8');
const denied = async () => (await loadSparkRules(files, gh)).rules.user.deny;

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

describe('seeding', () => {
  it('writes the recommended rules once, built from the old Settings choices', async () => {
    const old = { workflows: 'refused' as const, ghAllowed: ['gh release create'] };
    expect(await seedSparkRules(files, old)).toBe(true);
    expect(await userText()).toBe(recommendedRulesText(old));
    expect(await seedSparkRules(files, gh)).toBe(false);
    expect(await userText()).toBe(recommendedRulesText(old));
  });

  it('never adds back a rule the user deleted', async () => {
    await seedSparkRules(files, gh);
    const edited = (await userText()).replace('"Push",', '');
    await writeFile(files.user, edited);
    await seedSparkRules(files, gh);
    expect(await denied()).not.toContain('Push');
  });

  it('never writes the file again after the user deleted it', async () => {
    await seedSparkRules(files, gh);
    await rm(files.user);
    expect(await seedSparkRules(files, gh)).toBe(false);
    expect((await loadSparkRules(files, gh)).rules.user.deny).toEqual([]);
  });

  it('uses the recommended rules before the first seed', async () => {
    const loaded = await loadSparkRules(files, gh);
    expect(loaded.rules).toEqual(RECOMMENDED_RULES);
    expect(loaded.problems).toEqual([]);
  });
});

describe('a broken file', () => {
  it('fails safe to the recommended rules and reports it', async () => {
    await seedSparkRules(files, gh);
    await writeFile(files.user, '{ "permissions": { "deny": "Push" } }');
    const loaded = await loadSparkRules(files, gh);
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
    const loaded = await loadSparkRules(files, gh);
    expect(loaded.rules.managed).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.problems[0]).toMatchObject({ file: 'managed' });
  });

  it('is never overwritten by a change', async () => {
    await seedSparkRules(files, gh);
    await writeFile(files.user, '{ broken');
    await expect(changeSparkRules(files, gh, () => ({}))).rejects.toThrow(RulesFileError);
    expect(await userText()).toBe('{ broken');
  });
});

describe('changes', () => {
  it('seed first, then apply, keeping what Spark does not use', async () => {
    await seedSparkRules(files, gh);
    const seeded = JSON.parse(await userText());
    await writeFile(files.user, JSON.stringify({ ...seeded, note: 'mine' }));
    const loaded = await changeSparkRules(files, gh, () => ({
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
        changeSparkRules(files, gh, () => ({ add: [['allow', `Gh(release ${verb}x)`]] })),
      ),
    );
    const allowed = (await loadSparkRules(files, gh)).rules.user.allow;
    expect(allowed).toEqual(expect.arrayContaining(['Gh(release ax)', 'Gh(release dx)']));
    expect(await readFile(seededMarker(files), 'utf8')).not.toBe('');
  });
});
