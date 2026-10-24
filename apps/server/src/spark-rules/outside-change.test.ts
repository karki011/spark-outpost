import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptedRecordPath, rulesTextHash } from './accepted.ts';
import { RECOMMENDED_RULES, recommendedRulesText } from './recommended.ts';
import { RulesFileError } from './rules-file.ts';
import {
  acceptOutsideChange,
  acceptRulesBaseline,
  changeManagedRules,
  changeSparkRules,
  loadSparkRules,
  OUTSIDE_CHANGE_PROBLEM,
  readRulesFile,
  restoreAcceptedRules,
  StaleRulesError,
  type SparkRulesFiles,
} from './rules-store.ts';

let dir: string;
let files: SparkRulesFiles;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-outside-'));
  files = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const userText = () => readFile(files.user, 'utf8');
const seedRecommended = async () => {
  await mkdir(dirname(files.user), { recursive: true });
  await writeFile(files.user, recommendedRulesText());
  await acceptRulesBaseline(files);
};
const hashNow = async (file: string) => rulesTextHash(await readRulesFile(file));
const tamper = async () => {
  const text = (await userText()).replace('"Push(force)",', '');
  await writeFile(files.user, text);
};

describe('a change made outside Spark', () => {
  it('keeps the accepted rules and reports the change until the user reviews it', async () => {
    await seedRecommended();
    await tamper();
    const loaded = await loadSparkRules(files);
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.outside?.fileHash).toBe(await hashNow(files.user));
    expect(loaded.problems).toContainEqual({ file: 'user', message: OUTSIDE_CHANGE_PROBLEM });
  });

  it('treats a deleted file as a change too', async () => {
    await seedRecommended();
    await rm(files.user);
    const loaded = await loadSparkRules(files);
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    expect(loaded.outside).not.toBeNull();
  });

  it('applies the file once the user accepts it', async () => {
    await seedRecommended();
    await tamper();
    const accepted = await acceptOutsideChange(files, await hashNow(files.user));
    expect(accepted.outside).toBeNull();
    expect(accepted.rules.user.ask).not.toContain('Push(force)');
  });

  it('refuses an accept for a file that changed again since the review', async () => {
    await seedRecommended();
    await tamper();
    const reviewed = await hashNow(files.user);
    await writeFile(files.user, '{}');
    await expect(acceptOutsideChange(files, reviewed)).rejects.toThrow(StaleRulesError);
  });

  it('puts the accepted rules back when the user chooses Spark’s copy', async () => {
    await seedRecommended();
    const seeded = await userText();
    await tamper();
    const restored = await restoreAcceptedRules(files, await hashNow(files.user));
    expect(restored.outside).toBeNull();
    expect(await userText()).toBe(seeded);
  });

  it('refuses a put back for a file that changed again since the review', async () => {
    await seedRecommended();
    await tamper();
    const reviewed = await hashNow(files.user);
    await writeFile(files.user, '{"permissions":{"allow":["Push"]}}');
    await expect(restoreAcceptedRules(files, reviewed)).rejects.toThrow(
      'settings.json changed after you reviewed it',
    );
    expect(await userText()).toBe('{"permissions":{"allow":["Push"]}}');
  });

  it('refuses Spark’s own changes until the user reviews it', async () => {
    await seedRecommended();
    await tamper();
    const edited = await userText();
    await expect(
      changeSparkRules(files, () => ({ add: [['allow', 'Gh(release create)']] })),
    ).rejects.toThrow(RulesFileError);
    expect(await userText()).toBe(edited);
  });

  it('never flags Spark’s own writes', async () => {
    await seedRecommended();
    const saved = await changeSparkRules(files, () => ({ remove: [['deny', 'Push']] }));
    expect(saved.outside).toBeNull();
    expect(saved.rules.user.deny).not.toContain('Push');
  });

  it('never accepts a file it has no record of, keeping the recommended rules until review', async () => {
    await seedRecommended();
    await rm(acceptedRecordPath(files.user));
    await tamper();
    await acceptRulesBaseline(files);
    const loaded = await loadSparkRules(files);
    expect(loaded.outside).not.toBeNull();
    expect(loaded.rules.user).toEqual(RECOMMENDED_RULES.user);
    await restoreAcceptedRules(files, await hashNow(files.user));
    expect(await userText()).toBe(recommendedRulesText());
  });

  it('records the baseline in turn with Spark’s own writes', async () => {
    await Promise.all([
      changeSparkRules(files, () => ({ add: [['allow', 'Gh(release create)']] })),
      acceptRulesBaseline(files),
      acceptRulesBaseline(files),
    ]);
    const loaded = await loadSparkRules(files);
    expect(loaded.outside).toBeNull();
    expect(loaded.rules.user.allow).toEqual(['Gh(release create)']);
  });
});

describe('a change checked against the card', () => {
  it('refuses when the file changed after the card was shown', async () => {
    await seedRecommended();
    const shown = await hashNow(files.user);
    await changeSparkRules(files, () => ({ add: [['allow', 'Gh(release create)']] }));
    const before = await userText();
    await expect(
      changeSparkRules(files, () => ({ remove: [['deny', 'Push']] }), shown),
    ).rejects.toThrow(StaleRulesError);
    expect(await userText()).toBe(before);
  });

  it('writes the company file through the given writer, keeping its other keys', async () => {
    const shown = JSON.stringify({ team: 'x', permissions: { deny: [] } });
    await writeFile(files.managed, shown);
    const writes: string[] = [];
    const loaded = await changeManagedRules(
      files,
      { add: [['deny', 'Gh(repo delete)']] },
      await hashNow(files.managed),
      async (target, text, previousHash) => {
        writes.push(target, previousHash);
        await writeFile(target, text);
      },
    );
    expect(writes).toEqual([files.managed, rulesTextHash({ kind: 'text', text: shown })]);
    expect(loaded.rules.managed.deny).toEqual(['Gh(repo delete)']);
    expect(JSON.parse(await readFile(files.managed, 'utf8')).team).toBe('x');
  });

  it('lets other rules writes through while the company prompt waits', async () => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const company = changeManagedRules(
      files,
      { add: [['deny', 'Gh(repo delete)']] },
      await hashNow(files.managed),
      async (target, text) => {
        await waiting;
        await writeFile(target, text);
      },
    );
    const saved = await changeSparkRules(files, () => ({ add: [['allow', 'Gh(release create)']] }));
    expect(saved.rules.user.allow).toEqual(['Gh(release create)']);
    release();
    expect((await company).rules.managed.deny).toEqual(['Gh(repo delete)']);
  });

  it('never calls the company writer for a stale card', async () => {
    let called = false;
    const write = () => {
      called = true;
      return Promise.resolve();
    };
    const change = { add: [['deny', 'Push'] as const] };
    await expect(changeManagedRules(files, change, 'old', write)).rejects.toThrow(StaleRulesError);
    expect(called).toBe(false);
  });
});

describe('with no rules file yet', () => {
  it('sees a created file as a change outside Spark', async () => {
    await acceptRulesBaseline(files);
    await writeFile(files.user, JSON.stringify({ permissions: { allow: ['Gh(release create)'] } }));
    const loaded = await loadSparkRules(files);
    expect(loaded.outside).not.toBeNull();
    expect(loaded.rules.user.allow).not.toContain('Gh(release create)');
  });

  it('sees an empty file as a change outside Spark', async () => {
    await acceptRulesBaseline(files);
    await writeFile(files.user, '');
    expect((await loadSparkRules(files)).outside).not.toBeNull();
  });
});
