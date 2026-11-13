import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREW_FILES_MAX, CREW_FILE_MAX_BYTES } from '@spark-outpost/contracts';
import { crewSparksDir, crewWorkflowsDir, sparkFolderPath } from './folders.ts';
import {
  CREW_PROBLEMS,
  CrewFileConflictError,
  CrewFileNotFoundError,
  CrewFileProblemError,
  crewFileHash,
  deleteCrewFile,
  readCrewFile,
  readSparkInstructions,
  removeSparkFolder,
  saveCrewFile,
  writeSparkInstructions,
} from './spark-folder.ts';
import { briefSkills, sparkFolder } from './spark-skills.ts';

let base: string;
let outside: string;
let spark: string;

beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spark-crew-'));
  base = path.join(root, 'sparks');
  outside = path.join(root, 'outside');
  await mkdir(outside, { recursive: true });
  spark = randomUUID();
});

afterEach(async () => {
  await rm(path.dirname(base), { recursive: true, force: true });
});

const folder = () => sparkFolderPath(base, spark);
const create = (file: string, text: string) =>
  saveCrewFile(base, spark, { path: file, text, baseHash: null });

describe('where Spark folders live', () => {
  it('keys the folder by the Spark id under the channel folder', () => {
    const env = { SPARK_DATA_DIR: '/data', BRANCH_PREFIX: 'dev' };
    expect(crewSparksDir(env)).toBe('/data/dev/sparks');
    expect(crewWorkflowsDir(env)).toBe('/data/dev/workflows');
    expect(sparkFolderPath('/data/dev/sparks', spark.toUpperCase())).toBe(
      `/data/dev/sparks/${spark}`,
    );
  });

  it('takes absolute overrides for tests and ignores relative ones', () => {
    const env = { SPARK_DATA_DIR: '/data', SPARK_CREW_DIR: '/t/s', SPARK_WORKFLOWS_DIR: 'rel' };
    expect(crewSparksDir(env)).toBe('/t/s');
    expect(crewWorkflowsDir(env)).toBe('/data/spark/workflows');
  });

  it('refuses a folder name that is not a Spark id', () => {
    expect(() => sparkFolderPath(base, '../other')).toThrow();
  });
});

describe('saving and reading files', () => {
  it('creates a file, reads it back and lists it with its size', async () => {
    const saved = await create('skills/review/SKILL.md', 'héllo');
    expect(saved).toEqual({
      path: 'skills/review/SKILL.md',
      text: 'héllo',
      hash: crewFileHash('héllo'),
    });
    expect(await readCrewFile(base, spark, 'skills/review/SKILL.md')).toEqual(saved);
    expect((await sparkFolder(base, spark)).files).toEqual([
      { path: 'skills/review/SKILL.md', bytes: 6 },
    ]);
  });

  it('refuses to create a file that already exists', async () => {
    await create('notes.md', 'one');
    await expect(create('notes.md', 'two')).rejects.toBeInstanceOf(CrewFileConflictError);
    expect((await readCrewFile(base, spark, 'notes.md')).text).toBe('one');
  });

  it('saves over a file only when the base hash still matches', async () => {
    const first = await create('notes.md', 'one');
    const second = await saveCrewFile(base, spark, {
      path: 'notes.md',
      text: 'two',
      baseHash: first.hash,
    });
    expect(second.hash).toBe(crewFileHash('two'));
    await expect(
      saveCrewFile(base, spark, { path: 'notes.md', text: 'three', baseHash: first.hash }),
    ).rejects.toThrow(CREW_PROBLEMS.changed);
    expect((await readCrewFile(base, spark, 'notes.md')).text).toBe('two');
  });

  it('treats a file deleted since it was opened as changed', async () => {
    const first = await create('notes.md', 'one');
    await deleteCrewFile(base, spark, 'notes.md');
    await expect(
      saveCrewFile(base, spark, { path: 'notes.md', text: 'two', baseHash: first.hash }),
    ).rejects.toBeInstanceOf(CrewFileConflictError);
  });

  it('lets only one of two creates of the same file win', async () => {
    const results = await Promise.allSettled([create('a.md', 'one'), create('a.md', 'two')]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('leaves no temporary file behind', async () => {
    await create('a.md', 'one');
    expect(await readdir(folder())).toEqual(['a.md']);
  });

  it('reports a missing file as not found', async () => {
    await expect(readCrewFile(base, spark, 'nope.md')).rejects.toBeInstanceOf(
      CrewFileNotFoundError,
    );
  });
});

describe('paths that would leave the folder', () => {
  it.each(['../x.md', '/etc/passwd', 'a/../../x.md', '.hidden', 'a\\b', 'a//b', ''])(
    'refuses %j for read, save and delete',
    async (bad) => {
      await expect(readCrewFile(base, spark, bad)).rejects.toBeInstanceOf(CrewFileProblemError);
      await expect(create(bad, 'x')).rejects.toBeInstanceOf(CrewFileProblemError);
      await expect(deleteCrewFile(base, spark, bad)).rejects.toBeInstanceOf(CrewFileProblemError);
    },
  );

  it('does not follow a linked file out of the folder', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await mkdir(folder(), { recursive: true });
    await symlink(path.join(outside, 'secret.txt'), path.join(folder(), 'link.md'));
    await expect(readCrewFile(base, spark, 'link.md')).rejects.toThrow(CREW_PROBLEMS.link);
    await expect(
      saveCrewFile(base, spark, { path: 'link.md', text: 'x', baseHash: null }),
    ).rejects.toThrow(CREW_PROBLEMS.link);
    await expect(deleteCrewFile(base, spark, 'link.md')).rejects.toThrow(CREW_PROBLEMS.link);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    expect((await sparkFolder(base, spark)).files).toEqual([]);
  });

  it('does not write through a linked folder', async () => {
    await mkdir(folder(), { recursive: true });
    await symlink(outside, path.join(folder(), 'skills'));
    await expect(create('skills/x/SKILL.md', 'x')).rejects.toThrow(CREW_PROBLEMS.link);
    expect(await readdir(outside)).toEqual([]);
    expect((await sparkFolder(base, spark)).files).toEqual([]);
  });

  it('refuses a Spark folder that is itself a link', async () => {
    await mkdir(base, { recursive: true });
    await symlink(outside, folder());
    await expect(create('a.md', 'x')).rejects.toThrow(CREW_PROBLEMS.link);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe('limits', () => {
  it('refuses text over the size limit and accepts text at it', async () => {
    await expect(create('big.md', 'a'.repeat(CREW_FILE_MAX_BYTES + 1))).rejects.toThrow(
      CREW_PROBLEMS.large,
    );
    await expect(create('multi.md', 'é'.repeat(CREW_FILE_MAX_BYTES / 2 + 1))).rejects.toThrow(
      CREW_PROBLEMS.large,
    );
    await create('fits.md', 'a'.repeat(CREW_FILE_MAX_BYTES));
  });

  it('refuses to read a file on disk that is over the limit', async () => {
    await mkdir(folder(), { recursive: true });
    await writeFile(path.join(folder(), 'big.md'), 'a'.repeat(CREW_FILE_MAX_BYTES + 1));
    await expect(readCrewFile(base, spark, 'big.md')).rejects.toThrow(CREW_PROBLEMS.large);
  });

  it('refuses text that is not plain UTF-8', async () => {
    await expect(create('nul.md', 'a\0b')).rejects.toThrow(CREW_PROBLEMS.binary);
    await expect(create('half.md', 'a\ud800b')).rejects.toThrow(CREW_PROBLEMS.binary);
    await mkdir(folder(), { recursive: true });
    await writeFile(path.join(folder(), 'latin.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    await writeFile(path.join(folder(), 'image.md'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    await expect(readCrewFile(base, spark, 'latin.md')).rejects.toThrow(CREW_PROBLEMS.binary);
    await expect(readCrewFile(base, spark, 'image.md')).rejects.toThrow(CREW_PROBLEMS.binary);
  });

  it('holds the folder to the file count, while still saving over existing files', async () => {
    await mkdir(folder(), { recursive: true });
    await Promise.all(
      Array.from({ length: CREW_FILES_MAX }, (_unused, index) =>
        writeFile(path.join(folder(), `f${index}.md`), 'x'),
      ),
    );
    await expect(create('one-more.md', 'x')).rejects.toThrow(CREW_PROBLEMS.full);
    const saved = await saveCrewFile(base, spark, {
      path: 'f0.md',
      text: 'changed',
      baseHash: crewFileHash('x'),
    });
    expect(saved.text).toBe('changed');
    expect((await sparkFolder(base, spark)).files).toHaveLength(CREW_FILES_MAX);
  });

  it('refuses a file where a folder is and a folder where a file is', async () => {
    await create('skills/review/SKILL.md', 'x');
    await expect(create('skills/review', 'x')).rejects.toThrow(CREW_PROBLEMS.notFile);
    await expect(create('skills/review/SKILL.md/more.md', 'x')).rejects.toThrow(
      CREW_PROBLEMS.blocked,
    );
    await expect(readCrewFile(base, spark, 'skills')).rejects.toThrow(CREW_PROBLEMS.notFile);
  });
});

describe('deleting', () => {
  it('deletes a file and the folders it leaves empty', async () => {
    await create('skills/review/SKILL.md', 'x');
    await create('SPARK.md', 'keep');
    await deleteCrewFile(base, spark, 'skills/review/SKILL.md');
    expect(await readdir(folder())).toEqual(['SPARK.md']);
  });

  it('reports a missing file and refuses to delete a folder', async () => {
    await create('skills/review/SKILL.md', 'x');
    await expect(deleteCrewFile(base, spark, 'gone.md')).rejects.toBeInstanceOf(
      CrewFileNotFoundError,
    );
    await expect(deleteCrewFile(base, spark, 'skills')).rejects.toThrow(CREW_PROBLEMS.notFile);
  });

  it('removes the whole folder, and is quiet when there is none', async () => {
    await create('skills/review/SKILL.md', 'x');
    await removeSparkFolder(base, spark);
    await removeSparkFolder(base, spark);
    expect(await readdir(base)).toEqual([]);
  });
});

describe('instructions in SPARK.md', () => {
  it('reads nothing when the file is missing, and deletes it when emptied', async () => {
    expect(await readSparkInstructions(base, spark)).toBe('');
    await writeSparkInstructions(base, spark, 'Be brief.');
    expect(await readSparkInstructions(base, spark)).toBe('Be brief.');
    await writeSparkInstructions(base, spark, '');
    expect(await readSparkInstructions(base, spark)).toBe('');
    await writeSparkInstructions(base, spark, '');
  });

  it('holds more than the old 2,000 characters', async () => {
    const long = 'word '.repeat(2_000);
    await writeSparkInstructions(base, spark, long);
    expect(await readSparkInstructions(base, spark)).toBe(long);
  });
});

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\nSteps.\n`;

describe('skills', () => {
  it('lists skills by name and description with the folder to read', async () => {
    await create('skills/review/SKILL.md', skillFile('review', 'Review a diff'));
    await create('skills/review/check.sh', 'echo ok');
    await create('skills/audit/SKILL.md', skillFile('audit', 'Audit dependencies'));
    const listed = await sparkFolder(base, spark);
    expect(listed.sparkId).toBe(spark);
    expect(listed.skills).toEqual([
      { name: 'audit', description: 'Audit dependencies' },
      { name: 'review', description: 'Review a diff' },
    ]);
    expect(listed.problems).toEqual([]);
    expect(await briefSkills(base, spark)).toEqual([
      {
        name: 'audit',
        description: 'Audit dependencies',
        folder: path.join(folder(), 'skills', 'audit'),
      },
      {
        name: 'review',
        description: 'Review a diff',
        folder: path.join(folder(), 'skills', 'review'),
      },
    ]);
  });

  it('lists problems instead of throwing', async () => {
    await create('skills/plain/SKILL.md', 'No frontmatter here.');
    await create('skills/renamed/SKILL.md', skillFile('other', 'Does a thing'));
    await create('skills/empty/run.sh', 'echo');
    await mkdir(path.join(folder(), 'skills', 'binary'), { recursive: true });
    await writeFile(path.join(folder(), 'skills', 'binary', 'SKILL.md'), Buffer.from([0xff, 0]));
    const listed = await sparkFolder(base, spark);
    expect(listed.skills).toEqual([]);
    expect(listed.problems.map((problem) => problem.path).sort()).toEqual([
      'skills/binary/SKILL.md',
      'skills/empty',
      'skills/plain/SKILL.md',
      'skills/renamed/SKILL.md',
    ]);
    expect(listed.problems.every((problem) => problem.text.length > 0)).toBe(true);
  });

  it('returns an empty folder for a Spark that has none', async () => {
    expect(await sparkFolder(base, spark)).toEqual({
      sparkId: spark,
      files: [],
      skills: [],
      problems: [],
    });
  });
});
