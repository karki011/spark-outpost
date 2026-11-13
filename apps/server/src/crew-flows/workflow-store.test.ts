import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workflowSchema, type Workflow } from '@spark-outpost/contracts';
import {
  WorkflowChangedError,
  WorkflowExistsError,
  WorkflowNotFoundError,
  WorkflowProblemsError,
  workflowStore,
} from './workflow-store.ts';

const SPARK = randomUUID();
const KNOWN = new Set([SPARK]);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workflow-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function flow(id: string, name = 'Nightly'): Workflow {
  return workflowSchema.parse({
    id,
    name,
    steps: [
      { id: 'first', sparkId: SPARK },
      { id: 'second', sparkId: SPARK, dependsOn: ['first'] },
    ],
  });
}

describe('workflowStore', () => {
  it('lists nothing before the folder exists', async () => {
    const store = workflowStore(join(dir, 'missing'));
    expect(await store.list(KNOWN)).toEqual([]);
    expect(await store.read('nightly')).toBeNull();
  });

  it('writes one JSON file per workflow and reads it back with its hash', async () => {
    const store = workflowStore(dir);
    const saved = await store.save(flow('nightly'), null, KNOWN);

    expect(await readdir(dir)).toEqual(['nightly.json']);
    expect(JSON.parse(await readFile(join(dir, 'nightly.json'), 'utf8'))).toEqual(flow('nightly'));
    expect(await store.read('nightly')).toEqual(saved);
    expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists stages in order with a problem count', async () => {
    const store = workflowStore(dir);
    await store.save(flow('nightly'), null, KNOWN);
    await store.save(flow('audit', 'Audit'), null, KNOWN);

    const listed = await store.list(new Set());

    expect(listed.map((entry) => entry.id)).toEqual(['audit', 'nightly']);
    expect(listed[0]).toMatchObject({
      name: 'Audit',
      stages: [[{ stepId: 'first', sparkId: SPARK }], [{ stepId: 'second', sparkId: SPARK }]],
      problems: 2,
    });
  });

  it('saves over a file only from the hash that was read', async () => {
    const store = workflowStore(dir);
    const first = await store.save(flow('nightly'), null, KNOWN);

    await expect(store.save(flow('nightly'), null, KNOWN)).rejects.toBeInstanceOf(
      WorkflowExistsError,
    );
    await expect(store.save(flow('nightly', 'Later'), 'other', KNOWN)).rejects.toBeInstanceOf(
      WorkflowChangedError,
    );
    await expect(store.save(flow('gone'), first.hash, KNOWN)).rejects.toBeInstanceOf(
      WorkflowChangedError,
    );
    const second = await store.save(flow('nightly', 'Later'), first.hash, KNOWN);
    expect(second.hash).not.toBe(first.hash);
    await expect(store.save(flow('nightly'), first.hash, KNOWN)).rejects.toBeInstanceOf(
      WorkflowChangedError,
    );
  });

  it('refuses a workflow with problems and writes nothing', async () => {
    const store = workflowStore(dir);

    const refused = store.save(flow('nightly'), null, new Set());

    await expect(refused).rejects.toBeInstanceOf(WorkflowProblemsError);
    await expect(refused).rejects.toMatchObject({
      problems: [
        expect.objectContaining({ kind: 'unknown_spark', stepId: 'first' }),
        expect.anything(),
      ],
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('ignores files that are not a valid workflow for their name', async () => {
    const store = workflowStore(dir);
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'renamed.json'), JSON.stringify(flow('nightly')));
    await writeFile(join(dir, 'Not-A-Slug.json'), JSON.stringify(flow('nightly')));
    await writeFile(join(dir, 'notes.txt'), 'hello');

    expect(await store.list(KNOWN)).toEqual([]);
    expect(await store.read('broken')).toBeNull();
    expect(await store.read('renamed')).toBeNull();
  });

  it('never reads or deletes outside its folder', async () => {
    const store = workflowStore(dir);

    await expect(store.read('../secrets')).rejects.toBeInstanceOf(WorkflowNotFoundError);
    await expect(store.remove('../secrets')).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('deletes a workflow once', async () => {
    const store = workflowStore(dir);
    await store.save(flow('nightly'), null, KNOWN);

    await store.remove('nightly');

    expect(await readdir(dir)).toEqual([]);
    await expect(store.remove('nightly')).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });
});
