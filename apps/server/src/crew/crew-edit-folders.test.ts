import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREW_EDIT_FILES_MAX } from '@spark-outpost/contracts';
import { applySparkEdit } from './crew-edit-apply.ts';
import { CREW_EDIT_PROBLEMS, planSparkEdit } from './crew-edit-plan.ts';
import { crewFileEntries, saveCrewFile } from './spark-folder.ts';

let root: string;
let base: string;
let spark: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'spark-crew-folders-'));
  base = path.join(root, 'sparks');
  spark = randomUUID();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Input = { path: string; text: string | null };

const skill = (name: string) => `---\nname: ${name}\ndescription: Notes for ${name}\n---\nSteps.\n`;
const create = (file: string, text: string) =>
  saveCrewFile(base, spark, { path: file, text, baseHash: null });

async function allowed(files: Input[], remove: string | null = null, folder: string | null = null) {
  const planned = await planSparkEdit(base, spark, files, remove, folder);
  expect(planned.problems).toEqual([]);
  await applySparkEdit(base, spark, planned.files);
  return (await crewFileEntries(base, spark)).files.map((file) => file.path).sort();
}

async function exists(relative: string): Promise<boolean> {
  const folder = path.join(base, spark, relative);
  return stat(folder).then(
    () => true,
    () => false,
  );
}

describe('an agent changing a Spark folder as the user asks', () => {
  it('creates nested folders by writing a file inside them', async () => {
    expect(
      await allowed([
        { path: 'notes/2026/style.md', text: 'Plain words.\n' },
        { path: 'skills/check/SKILL.md', text: skill('check') },
        { path: 'skills/check/scripts/run.sh', text: 'echo ok\n' },
      ]),
    ).toEqual(['notes/2026/style.md', 'skills/check/SKILL.md', 'skills/check/scripts/run.sh']);
  });

  it('updates a file and deletes one inside a skill’s scripts folder', async () => {
    await create('skills/check/SKILL.md', skill('check'));
    await create('skills/check/scripts/run.sh', 'echo ok\n');
    await create('skills/check/scripts/old.sh', 'echo old\n');
    expect(
      await allowed([
        { path: 'skills/check/scripts/run.sh', text: 'echo better\n' },
        { path: 'skills/check/scripts/old.sh', text: null },
      ]),
    ).toEqual(['skills/check/SKILL.md', 'skills/check/scripts/run.sh']);
  });

  it('deletes a whole folder that is not a skill, and the empty folder goes with it', async () => {
    await create('SPARK.md', 'Instructions.\n');
    await create('notes/a.md', 'a\n');
    await create('notes/deep/b.md', 'b\n');
    expect(await allowed([], null, 'notes')).toEqual(['SPARK.md']);
    expect(await exists('notes')).toBe(false);
  });

  it('deletes a folder inside a skill and keeps the skill', async () => {
    await create('skills/check/SKILL.md', skill('check'));
    await create('skills/check/scripts/run.sh', 'echo ok\n');
    expect(await allowed([], null, 'skills/check/scripts/')).toEqual(['skills/check/SKILL.md']);
  });

  it('moves a file in one change', async () => {
    await create('notes/style.md', 'Plain words.\n');
    expect(
      await allowed([
        { path: 'notes/style.md', text: null },
        { path: 'guides/style.md', text: 'Plain words.\n' },
      ]),
    ).toEqual(['guides/style.md']);
  });

  it('renames a skill by writing the new folder and removing the old one', async () => {
    await create('skills/old/SKILL.md', skill('old'));
    await create('skills/old/run.sh', 'echo ok\n');
    expect(
      await allowed(
        [
          { path: 'skills/new/SKILL.md', text: skill('new') },
          { path: 'skills/new/run.sh', text: 'echo ok\n' },
        ],
        'old',
      ),
    ).toEqual(['skills/new/SKILL.md', 'skills/new/run.sh']);
  });

  it('says so when the folder has no files, or the path is not one', async () => {
    const empty = await planSparkEdit(base, spark, [], null, 'notes');
    expect(empty.problems).toEqual([{ path: 'notes', text: CREW_EDIT_PROBLEMS.noFolder }]);
    const outside = await planSparkEdit(base, spark, [], null, '../other');
    expect(outside.problems).toHaveLength(1);
    expect(outside.files).toEqual([]);
  });

  it('asks for several calls when a folder holds more files than one change can carry', async () => {
    for (let index = 0; index <= CREW_EDIT_FILES_MAX; index += 1) {
      await create(`notes/n${index}.md`, `${index}\n`);
    }
    const planned = await planSparkEdit(base, spark, [], null, 'notes');
    expect(planned.problems).toEqual([{ path: '', text: CREW_EDIT_PROBLEMS.tooMany }]);
  });
});
