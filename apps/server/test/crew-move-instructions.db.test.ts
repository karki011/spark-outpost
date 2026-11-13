import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneOldRows } from '../src/api/startup-prune.ts';
import { sparkFolderPath } from '../src/crew/folders.ts';
import { moveInstructionsToFolders } from '../src/crew/move-instructions.ts';
import { sparkBrief } from '../src/crew/spark-brief.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { teammateBrief } from '../src/persistence/teammate-chats.ts';
import { getTeammate, updateTeammate } from '../src/persistence/teammates.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let sparks: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await mkdtemp(path.join(tmpdir(), 'spark-crew-move-'));
  sparks = path.join(root, 'sparks');
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

async function legacySpark(name: string, instructions: string, instructionsPath?: string) {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO teammates (id, workspace_id, name, instructions, instructions_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, t.workspaceId, name, instructions, instructionsPath ?? null],
  );
  return id;
}

async function stored(id: string) {
  const { rows } = await t.db.query<{ instructions: string; moved: boolean }>(
    `SELECT instructions, instructions_moved_at IS NOT NULL AS moved FROM teammates WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

const sparkFile = (id: string) => path.join(sparkFolderPath(sparks, id), 'SPARK.md');
const onDisk = (id: string) => readFile(sparkFile(id), 'utf8');

async function briefOf(id: string) {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId);
  await t.db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [conversationId, id]);
  const brief = await teammateBrief(t.db, conversationId);
  return sparkBrief(brief!, sparks);
}

describe('moving instructions into SPARK.md', () => {
  it('writes each Spark’s text to its folder, empties the column and marks the row', async () => {
    const pip = await legacySpark('Pip', 'Name the file and line.');
    const wren = await legacySpark('Wren', '  Short sentences.  ');
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 2, failed: [] });
    expect(await onDisk(pip)).toBe('Name the file and line.');
    expect(await onDisk(wren)).toBe('Short sentences.');
    expect(await stored(pip)).toEqual({ instructions: '', moved: true });
    expect((await getTeammate(t.db, t.workspaceId, pip, sparks)).instructions).toBe(
      'Name the file and line.',
    );
  });

  it('does nothing the second time, and keeps later edits', async () => {
    const pip = await legacySpark('Pip', 'Old text.');
    await moveInstructionsToFolders(t.db, sparks);
    await updateTeammate(t.db, t.workspaceId, pip, { instructions: 'New text.' }, sparks);
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 0, failed: [] });
    expect(await onDisk(pip)).toBe('New text.');
  });

  it('finishes a move that stopped after the file was written', async () => {
    const pip = await legacySpark('Pip', 'Name the file and line.');
    await mkdir(sparkFolderPath(sparks, pip), { recursive: true });
    await writeFile(sparkFile(pip), 'Name the file and line.');
    expect(await stored(pip)).toEqual({ instructions: 'Name the file and line.', moved: false });
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 1, failed: [] });
    expect(await onDisk(pip)).toBe('Name the file and line.');
    expect(await stored(pip)).toEqual({ instructions: '', moved: true });
  });

  it('never overwrites a SPARK.md that is already there', async () => {
    const pip = await legacySpark('Pip', 'Column text.');
    await mkdir(sparkFolderPath(sparks, pip), { recursive: true });
    await writeFile(sparkFile(pip), 'Folder text.');
    await moveInstructionsToFolders(t.db, sparks);
    expect(await onDisk(pip)).toBe('Folder text.');
  });

  it('makes no file for a Spark without instructions', async () => {
    const pip = await legacySpark('Pip', '');
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 1, failed: [] });
    expect(await readdir(sparks).catch(() => [])).toEqual([]);
    expect(await stored(pip)).toEqual({ instructions: '', moved: true });
  });

  it('keeps the text in the database when the folder cannot be written, and retries', async () => {
    const pip = await legacySpark('Pip', 'Name the file and line.');
    await writeFile(sparks, 'a file where the folder should be');
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 0, failed: [pip] });
    expect(await stored(pip)).toEqual({ instructions: 'Name the file and line.', moved: false });
    expect((await briefOf(pip)).instructions).toBe('Name the file and line.');
    await rm(sparks);
    expect(await moveInstructionsToFolders(t.db, sparks)).toEqual({ moved: 1, failed: [] });
    expect(await onDisk(pip)).toBe('Name the file and line.');
  });

  it('still briefs a Spark from the database before its row is moved', async () => {
    const pip = await legacySpark('Pip', 'Name the file and line.');
    expect((await getTeammate(t.db, t.workspaceId, pip, sparks)).instructions).toBe(
      'Name the file and line.',
    );
    expect(await briefOf(pip)).toMatchObject({
      name: 'Pip',
      instructions: 'Name the file and line.',
      folder: null,
      skills: [],
    });
  });
});

describe('a Spark with an external instructions file', () => {
  it('keeps the file as its brief, and moves the typed text all the same', async () => {
    const external = path.join(root, 'reviewer.md');
    await writeFile(external, 'From the external file.');
    const pip = await legacySpark('Pip', 'Typed fallback.', external);
    await moveInstructionsToFolders(t.db, sparks);
    expect(await onDisk(pip)).toBe('Typed fallback.');
    expect((await briefOf(pip)).instructions).toBe('From the external file.');
    const teammate = await getTeammate(t.db, t.workspaceId, pip, sparks);
    expect(teammate).toMatchObject({ instructions: 'Typed fallback.', instructionsPath: external });
  });

  it('falls back to SPARK.md when the external file is gone', async () => {
    const external = path.join(root, 'reviewer.md');
    await writeFile(external, 'From the external file.');
    const pip = await legacySpark('Pip', 'Typed fallback.', external);
    await moveInstructionsToFolders(t.db, sparks);
    await rm(external);
    expect((await briefOf(pip)).instructions).toBe('Typed fallback.');
  });
});

describe('the brief after the move', () => {
  it('reads long instructions and the skill list from the folder', async () => {
    const pip = await legacySpark('Pip', 'Old.');
    await moveInstructionsToFolders(t.db, sparks);
    const long = 'Check every changed line.\n'.repeat(400).trim();
    await updateTeammate(t.db, t.workspaceId, pip, { instructions: long }, sparks);
    const skill = path.join(sparkFolderPath(sparks, pip), 'skills', 'review');
    await mkdir(skill, { recursive: true });
    await writeFile(
      path.join(skill, 'SKILL.md'),
      '---\nname: review\ndescription: Review a diff\n---\nSteps.\n',
    );
    const brief = await briefOf(pip);
    expect(brief.instructions).toBe(long);
    expect(brief.instructions.length).toBeGreaterThan(2_000);
    expect(brief.folder).toBe(sparkFolderPath(sparks, pip));
    expect(brief.skills).toEqual([{ name: 'review', description: 'Review a diff', folder: skill }]);
  });
});

describe('folders of removed Sparks', () => {
  it('are deleted at the next prune, and nothing else is', async () => {
    const pip = await legacySpark('Pip', 'Stay.');
    await moveInstructionsToFolders(t.db, sparks);
    const orphan = randomUUID();
    await mkdir(sparkFolderPath(sparks, orphan), { recursive: true });
    await writeFile(path.join(sparkFolderPath(sparks, orphan), 'SPARK.md'), 'Gone.');
    await mkdir(path.join(sparks, 'not-a-spark'), { recursive: true });
    await pruneOldRows({
      db: t.db,
      workspaceId: t.workspaceId,
      auditRetentionDays: 90,
      sparkFolders: sparks,
    });
    expect((await readdir(sparks)).sort()).toEqual(['not-a-spark', pip].sort());
    expect(await onDisk(pip)).toBe('Stay.');
  });
});
