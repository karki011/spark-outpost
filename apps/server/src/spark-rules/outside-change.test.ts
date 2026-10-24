import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SPARK_RULES } from '@spark-outpost/contracts';
import { acceptedRecordPath, rulesTextHash } from './accepted.ts';
import { RECOMMENDED_RULES } from './recommended.ts';
import { RulesFileError } from './rules-file.ts';
import {
  acceptOutsideChange,
  changeManagedRules,
  changeSparkRules,
  loadSparkRules,
  OUTSIDE_CHANGE_PROBLEM,
  readRulesFile,
  restoreAcceptedRules,
  seedSparkRules,
  StaleRulesError,
  type SparkRulesFiles,
} from './rules-store.ts';

let dir: string;
let files: SparkRulesFiles;
const gh = DEFAULT_SPARK_RULES;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-outside-'));
  files = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const userText = () => readFile(files.user, 'utf8');
const hashNow = async (file: string) => rulesTextHash(await readRulesFile(file));
const tamper = async () => {
  const text = (await userText()).replace('"Push(force)",', '');
  await writeFile(files.user, text);
};

describe('a change made outside Spark', () => {
  it('keeps the accepted rules and reports the change until the user reviews it', async () => {
    await seedSparkRules(files, gh);
    await tamper();
    const loaded = await loadSparkRules(files, gh);
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.outside?.fileHash).toBe(await hashNow(files.user));
    expect(loaded.problems).toContainEqual({ file: 'user', message: OUTSIDE_CHANGE_PROBLEM });
  });

  it('treats a deleted file as a change too', async () => {
    await seedSparkRules(files, gh);
    await rm(files.user);
    const loaded = await loadSparkRules(files, gh);
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.outside).not.toBeNull();
  });

  it('applies the file once the user accepts it', async () => {
    await seedSparkRules(files, gh);
    await tamper();
    const accepted = await acceptOutsideChange(files, gh, await hashNow(files.user));
    expect(accepted.outside).toBeNull();
    expect(accepted.rules.user.ask).not.toContain('Push(force)');
  });

  it('refuses an accept for a file that changed again since the review', async () => {
    await seedSparkRules(files, gh);
    await tamper();
    const reviewed = await hashNow(files.user);
    await writeFile(files.user, '{}');
    await expect(acceptOutsideChange(files, gh, reviewed)).rejects.toThrow(StaleRulesError);
  });

  it('puts the accepted rules back when the user chooses Spark’s copy', async () => {
    const seeded = await seedSparkRules(files, gh).then(userText);
    await tamper();
    const restored = await restoreAcceptedRules(files, gh);
    expect(restored.outside).toBeNull();
    expect(await userText()).toBe(seeded);
  });

  it('refuses Spark’s own changes until the user reviews it', async () => {
    await seedSparkRules(files, gh);
    await tamper();
    const edited = await userText();
    await expect(
      changeSparkRules(files, gh, () => ({ add: [['allow', 'Gh(release create)']] })),
    ).rejects.toThrow(RulesFileError);
    expect(await userText()).toBe(edited);
  });

  it('never flags Spark’s own writes', async () => {
    await seedSparkRules(files, gh);
    const saved = await changeSparkRules(files, gh, () => ({ remove: [['deny', 'Push']] }));
    expect(saved.outside).toBeNull();
    expect(saved.rules.user.deny).not.toContain('Push');
  });

  it('accepts what is on disk the first time, for files written before this check', async () => {
    await seedSparkRules(files, gh);
    await rm(acceptedRecordPath(files.user));
    await tamper();
    await seedSparkRules(files, gh);
    const loaded = await loadSparkRules(files, gh);
    expect(loaded.outside).toBeNull();
    expect(loaded.rules.user.ask).not.toContain('Push(force)');
  });
});

describe('a change checked against the card', () => {
  it('refuses when the file changed after the card was shown', async () => {
    await seedSparkRules(files, gh);
    const shown = await hashNow(files.user);
    await changeSparkRules(files, gh, () => ({ add: [['allow', 'Gh(release create)']] }));
    const before = await userText();
    await expect(
      changeSparkRules(files, gh, () => ({ remove: [['deny', 'Push']] }), shown),
    ).rejects.toThrow(StaleRulesError);
    expect(await userText()).toBe(before);
  });

  it('writes the company file through the given writer, keeping its other keys', async () => {
    await writeFile(files.managed, JSON.stringify({ team: 'x', permissions: { deny: [] } }));
    const writes: string[] = [];
    const loaded = await changeManagedRules(
      files,
      gh,
      { add: [['deny', 'Gh(repo delete)']] },
      await hashNow(files.managed),
      async (target, text) => {
        writes.push(target);
        await writeFile(target, text);
      },
    );
    expect(writes).toEqual([files.managed]);
    expect(loaded.rules.managed.deny).toEqual(['Gh(repo delete)']);
    expect(JSON.parse(await readFile(files.managed, 'utf8')).team).toBe('x');
  });

  it('never calls the company writer for a stale card', async () => {
    let called = false;
    const write = () => {
      called = true;
      return Promise.resolve();
    };
    const change = { add: [['deny', 'Push'] as const] };
    await expect(changeManagedRules(files, gh, change, 'old', write)).rejects.toThrow(
      StaleRulesError,
    );
    expect(called).toBe(false);
  });
});
