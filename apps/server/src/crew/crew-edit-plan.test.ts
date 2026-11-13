import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CREW_EDIT_FILES_MAX,
  CREW_FILES_MAX,
  CREW_FILE_MAX_BYTES,
  workflowSchema,
} from '@spark-outpost/contracts';
import { workflowStore } from '../crew-flows/workflow-store.ts';
import { applySparkEdit, applyWorkflowEdit, CrewEditConflictError } from './crew-edit-apply.ts';
import { CREW_EDIT_PROBLEMS, planSparkEdit, skillNameProblem } from './crew-edit-plan.ts';
import { CREW_PROBLEMS, crewFileHash, readCrewFile, saveCrewFile } from './spark-folder.ts';
import { sparkFolder } from './spark-skills.ts';
import {
  planWorkflowRemoval,
  planWorkflowSave,
  WORKFLOW_EDIT_PROBLEMS,
} from './workflow-edit-plan.ts';

let root: string;
let base: string;
let spark: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'spark-crew-edit-'));
  base = path.join(root, 'sparks');
  spark = randomUUID();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const skill = (name: string, description = 'Write release notes') =>
  `---\nname: ${name}\ndescription: ${description}\n---\nSteps.\n`;
const create = (file: string, text: string) =>
  saveCrewFile(base, spark, { path: file, text, baseHash: null });
const plan = (files: { path: string; text: string | null }[], remove: string | null = null) =>
  planSparkEdit(base, spark, files, remove);
const problemsOf = async (files: { path: string; text: string | null }[]) =>
  (await plan(files)).problems;

describe('planning a change to a Spark folder', () => {
  it('plans a new skill with its script as new files and names the skill', async () => {
    const planned = await plan([
      { path: 'skills/notes/SKILL.md', text: skill('notes') },
      { path: 'skills/notes/run.sh', text: 'echo notes\n' },
    ]);
    expect(planned.problems).toEqual([]);
    expect(planned.files.map((file) => [file.path, file.change, file.baseHash])).toEqual([
      ['skills/notes/SKILL.md', 'new', null],
      ['skills/notes/run.sh', 'new', null],
    ]);
    expect(planned.newSkills).toEqual([{ name: 'notes', description: 'Write release notes' }]);
  });

  it('plans a change with the text and hash it replaces, and drops what is unchanged', async () => {
    await create('SPARK.md', 'Be brief.\n');
    await create('notes.txt', 'same\n');
    const planned = await plan([
      { path: 'SPARK.md', text: 'Be thorough.\n' },
      { path: 'notes.txt', text: 'same\n' },
    ]);
    expect(planned.files).toEqual([
      {
        path: 'SPARK.md',
        change: 'changed',
        before: 'Be brief.\n',
        after: 'Be thorough.\n',
        baseHash: crewFileHash('Be brief.\n'),
      },
    ]);
  });

  it('plans the delete of every file in a skill folder', async () => {
    await create('skills/notes/SKILL.md', skill('notes'));
    await create('skills/notes/lib/run.sh', 'echo\n');
    const planned = await plan([], 'notes');
    expect(planned.problems).toEqual([]);
    expect(planned.files.map((file) => [file.path, file.change])).toEqual([
      ['skills/notes/SKILL.md', 'deleted'],
      ['skills/notes/lib/run.sh', 'deleted'],
    ]);
  });

  it.each([
    ['../escape.md', 'x', 'Folder and file names use'],
    ['/abs.md', 'x', 'Use a path inside the Spark folder'],
    ['.hidden', 'x', 'Folder and file names use'],
    ['a/b/c/d/e/f/g.md', 'x', 'folders deep'],
    ['', 'x', 'Enter a file name.'],
    ['big.txt', 'x'.repeat(CREW_FILE_MAX_BYTES + 1), CREW_PROBLEMS.large],
    ['nul.txt', 'a\0b', CREW_PROBLEMS.binary],
    ['gone.txt', null, CREW_EDIT_PROBLEMS.noFile],
  ])('reports %s', async (file, text, problem) => {
    const problems = await problemsOf([{ path: file, text }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: file });
    expect(problems[0]!.text).toContain(problem);
  });

  it('reports a path given twice and a file used as a folder', async () => {
    await create('notes', 'a file\n');
    expect(
      await problemsOf([
        { path: 'a.md', text: 'one' },
        { path: 'a.md', text: 'two' },
      ]),
    ).toEqual([{ path: 'a.md', text: CREW_EDIT_PROBLEMS.twice }]);
    expect(await problemsOf([{ path: 'notes/more.md', text: 'x' }])).toEqual([
      { path: 'notes/more.md', text: CREW_PROBLEMS.blocked },
    ]);
    expect(
      await problemsOf([
        { path: 'docs', text: 'x' },
        { path: 'docs/more.md', text: 'x' },
      ]),
    ).toEqual([{ path: 'docs/more.md', text: CREW_EDIT_PROBLEMS.inTheWay }]);
  });

  it('reports a skill file without its block, name or description', async () => {
    const at = 'skills/notes/SKILL.md';
    expect((await problemsOf([{ path: at, text: 'No block.\n' }]))[0]!.text).toContain(
      'starts with a block between --- lines',
    );
    expect(
      (await problemsOf([{ path: at, text: '---\ndescription: Notes\n---\n' }]))[0]!.text,
    ).toContain('needs a name');
    expect((await problemsOf([{ path: at, text: '---\nname: notes\n---\n' }]))[0]!.text).toContain(
      'needs a description',
    );
  });

  it('reports a skill whose name is not its folder name', async () => {
    expect(await problemsOf([{ path: 'skills/notes/SKILL.md', text: skill('other') }])).toEqual([
      { path: 'skills/notes/SKILL.md', text: skillNameProblem('notes') },
    ]);
  });

  it('reports a skill folder left without its SKILL.md', async () => {
    expect(await problemsOf([{ path: 'skills/notes/run.sh', text: 'echo\n' }])).toEqual([
      { path: 'skills/notes', text: CREW_EDIT_PROBLEMS.skillFile },
    ]);
    await create('skills/notes/SKILL.md', skill('notes'));
    await create('skills/notes/run.sh', 'echo\n');
    expect(await problemsOf([{ path: 'skills/notes/SKILL.md', text: null }])).toEqual([
      { path: 'skills/notes', text: CREW_EDIT_PROBLEMS.skillLeft },
    ]);
  });

  it('reports a skill folder that does not exist, too many files and a full folder', async () => {
    expect((await plan([], 'missing')).problems).toEqual([
      { path: 'skills/missing', text: CREW_EDIT_PROBLEMS.noSkill },
    ]);
    const many = Array.from({ length: CREW_EDIT_FILES_MAX + 1 }, (_, index) => ({
      path: `f${index}.txt`,
      text: 'x',
    }));
    expect(await problemsOf(many)).toEqual([{ path: '', text: CREW_EDIT_PROBLEMS.tooMany }]);
    for (let index = 0; index < CREW_FILES_MAX; index += 1) await create(`n${index}.txt`, 'x');
    expect(await problemsOf([{ path: 'one-more.txt', text: 'x' }])).toEqual([
      { path: '', text: CREW_PROBLEMS.full },
    ]);
  });

  it('reports a call that carries more text than one card holds', async () => {
    const half = 'x'.repeat(CREW_FILE_MAX_BYTES);
    const problems = await problemsOf([
      { path: 'a.txt', text: half },
      { path: 'b.txt', text: half },
      { path: 'c.txt', text: 'x' },
    ]);
    expect(problems).toEqual([{ path: '', text: CREW_EDIT_PROBLEMS.tooLarge }]);
  });
});

describe('writing a planned change', () => {
  it('writes new, changed and deleted files and leaves a readable skill', async () => {
    await create('SPARK.md', 'Be brief.\n');
    await create('old.txt', 'old\n');
    const planned = await plan([
      { path: 'SPARK.md', text: 'Be thorough.\n' },
      { path: 'old.txt', text: null },
      { path: 'skills/notes/SKILL.md', text: skill('notes') },
    ]);
    await applySparkEdit(base, spark, planned.files);
    expect((await readCrewFile(base, spark, 'SPARK.md')).text).toBe('Be thorough.\n');
    const folder = await sparkFolder(base, spark);
    expect(folder.files.map((file) => file.path)).toEqual(['SPARK.md', 'skills/notes/SKILL.md']);
    expect(folder.skills).toEqual([{ name: 'notes', description: 'Write release notes' }]);
  });

  it('writes nothing when one file changed after the plan', async () => {
    await create('SPARK.md', 'Be brief.\n');
    const planned = await plan([
      { path: 'SPARK.md', text: 'Be thorough.\n' },
      { path: 'new.txt', text: 'new\n' },
    ]);
    await saveCrewFile(base, spark, {
      path: 'SPARK.md',
      text: 'Edited by hand.\n',
      baseHash: crewFileHash('Be brief.\n'),
    });
    const failure = applySparkEdit(base, spark, planned.files);
    await expect(failure).rejects.toBeInstanceOf(CrewEditConflictError);
    await expect(failure).rejects.toThrow('SPARK.md. Spark changed nothing.');
    expect((await readCrewFile(base, spark, 'SPARK.md')).text).toBe('Edited by hand.\n');
    expect((await sparkFolder(base, spark)).files.map((file) => file.path)).toEqual(['SPARK.md']);
  });

  it('conflicts when a new file appeared or a file to delete is gone', async () => {
    const added = await plan([{ path: 'new.txt', text: 'mine\n' }]);
    await create('new.txt', 'theirs\n');
    await expect(applySparkEdit(base, spark, added.files)).rejects.toBeInstanceOf(
      CrewEditConflictError,
    );
    const removed = await plan([{ path: 'new.txt', text: null }]);
    await rm(path.join(base, spark, 'new.txt'));
    await expect(applySparkEdit(base, spark, removed.files)).rejects.toBeInstanceOf(
      CrewEditConflictError,
    );
  });
});

describe('planning and writing a workflow', () => {
  const sparks = [
    { id: randomUUID(), name: 'Scout' },
    { id: randomUUID(), name: 'Scribe' },
  ];
  const ids = new Set(sparks.map((each) => each.id));
  const store = () => workflowStore(path.join(root, 'workflows'));
  const nightly = {
    id: 'nightly',
    name: 'Nightly',
    steps: [
      { id: 'look', spark: 'scout' },
      { id: 'write', spark: sparks[1]!.id, dependsOn: ['look'] },
    ],
  };

  it('resolves Spark names, plans a new file and writes it', async () => {
    const planned = await planWorkflowSave(store(), nightly, sparks);
    expect(planned.problems).toEqual([]);
    expect(planned.stages).toEqual([['Scout'], ['Scribe']]);
    expect(planned.file).toMatchObject({ path: 'nightly.json', change: 'new', baseHash: null });
    await applyWorkflowEdit(store(), 'nightly', planned.file!, ids);
    const saved = await store().read('nightly');
    expect(saved!.workflow.steps.map((step) => step.sparkId)).toEqual(sparks.map((s) => s.id));
    expect((await planWorkflowSave(store(), nightly, sparks)).file).toBeNull();
  });

  it.each([
    [{ ...nightly, steps: [{ id: 'look', spark: 'Nobody' }] }, 'look', 'No Spark called Nobody'],
    [{ ...nightly, id: 'Bad Id' }, 'id', ''],
    [{ ...nightly, name: '' }, 'name', ''],
    [{ ...nightly, steps: [] }, 'steps', ''],
    ['not a workflow', 'workflow', WORKFLOW_EDIT_PROBLEMS.shape],
    [
      { ...nightly, steps: [...nightly.steps, { id: 'look', spark: 'Scout' }] },
      'look',
      'Two steps are called look.',
    ],
    [
      { ...nightly, steps: [{ id: 'look', spark: 'Scout', dependsOn: ['later'] }] },
      'look',
      "which isn't a step",
    ],
    [
      {
        ...nightly,
        steps: [
          { id: 'look', spark: 'Scout', dependsOn: ['write'] },
          { id: 'write', spark: 'Scribe', dependsOn: ['look'] },
        ],
      },
      'look',
      'wait on each other',
    ],
    [
      { ...nightly, steps: [{ id: 'look', sparkId: randomUUID() }] },
      'look',
      'uses a Spark that no longer exists',
    ],
  ])('reports a workflow problem %#', async (raw, where, text) => {
    const planned = await planWorkflowSave(store(), raw, sparks);
    expect(planned.file).toBeNull();
    expect(planned.problems[0]).toMatchObject({ path: where });
    expect(planned.problems[0]!.text).toContain(text);
  });

  it('conflicts when the workflow changed or appeared after the plan', async () => {
    const created = await planWorkflowSave(store(), nightly, sparks);
    await applyWorkflowEdit(store(), 'nightly', created.file!, ids);
    await expect(applyWorkflowEdit(store(), 'nightly', created.file!, ids)).rejects.toBeInstanceOf(
      CrewEditConflictError,
    );
    const renamed = await planWorkflowSave(store(), { ...nightly, name: 'Nightly run' }, sparks);
    expect(renamed.file).toMatchObject({ change: 'changed' });
    const current = await store().read('nightly');
    await store().save(
      workflowSchema.parse({ ...current!.workflow, name: 'By hand' }),
      current!.hash,
      ids,
    );
    await expect(applyWorkflowEdit(store(), 'nightly', renamed.file!, ids)).rejects.toBeInstanceOf(
      CrewEditConflictError,
    );
    expect((await store().read('nightly'))!.workflow.name).toBe('By hand');
  });

  it('plans and writes a delete, and reports a workflow that is not there', async () => {
    const created = await planWorkflowSave(store(), nightly, sparks);
    await applyWorkflowEdit(store(), 'nightly', created.file!, ids);
    const removal = await planWorkflowRemoval(store(), 'nightly', sparks);
    expect(removal.file).toMatchObject({ change: 'deleted', after: null });
    await applyWorkflowEdit(store(), 'nightly', removal.file!, ids);
    expect(await store().read('nightly')).toBeNull();
    expect((await planWorkflowRemoval(store(), 'nightly', sparks)).problems).toEqual([
      { path: 'nightly.json', text: WORKFLOW_EDIT_PROBLEMS.missing },
    ]);
  });
});
